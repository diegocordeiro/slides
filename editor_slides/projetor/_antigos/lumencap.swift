// lumencap – captura a tela do Mac (ScreenCaptureKit), codifica em H.264 por hardware
// (VideoToolbox) e envia ao Lumen Cast no Fire TV. Compilado automaticamente pelo projetar.sh.
//
// Uso: lumencap --host IP [--port 7000] [--display 1] [--width 1920] [--height 1080]
//               [--fps 30] [--bitrate 6000000] [--out arquivo.h264 --seconds 4] [--list]
// Códigos de saída: 2 = conexão perdida, 3 = sem permissão de Gravação de Tela, 4 = tela inválida

import Foundation
import CoreMedia
import CoreVideo
import CoreGraphics
import VideoToolbox
import ScreenCaptureKit
import AppKit

func arg(_ name: String, _ def: String) -> String {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: name), i + 1 < a.count { return a[i + 1] }
    return def
}

func say(_ s: String) {
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

func fail(_ msg: String, _ code: Int32) -> Never {
    say(msg)
    exit(code)
}

let host = arg("--host", "")
let port = UInt16(arg("--port", "7000")) ?? 7000
let displayN = Int(arg("--display", "1")) ?? 1
let W = Int(arg("--width", "1920")) ?? 1920
let H = Int(arg("--height", "1080")) ?? 1080
let FPS = Int(arg("--fps", "30")) ?? 30
let BR = Int(arg("--bitrate", "6000000")) ?? 6_000_000
let outFile = arg("--out", "")
let seconds = Double(arg("--seconds", "0")) ?? 0
let listOnly = CommandLine.arguments.contains("--list")
let verbose = CommandLine.arguments.contains("--verbose")
func step(_ s: String) { if verbose { say("· " + s) } }

func firstAttachment(_ sb: CMSampleBuffer) -> NSDictionary? {
    guard let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false),
          CFArrayGetCount(arr) > 0, let v = CFArrayGetValueAtIndex(arr, 0) else { return nil }
    return unsafeBitCast(v, to: CFDictionary.self) as NSDictionary
}

// MARK: - Saída (TCP para a TV, ou arquivo no modo de teste)

final class Sink: @unchecked Sendable {
    private var fd: Int32 = -1
    private let lock = NSLock()
    var bytes = 0

    init() {
        if !outFile.isEmpty {
            fd = open(outFile, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
            if fd < 0 { fail("Não consegui criar \(outFile)", 1) }
            return
        }
        fd = socket(AF_INET, SOCK_STREAM, 0)
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        if inet_pton(AF_INET, host, &addr.sin_addr) != 1 { fail("IP inválido: \(host)", 1) }
        let r = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        if r != 0 { fail("Não conectou em \(host):\(port) (o Lumen Cast está aberto na TV?)", 2) }
        var one: Int32 = 1
        setsockopt(fd, Int32(IPPROTO_TCP), TCP_NODELAY, &one, socklen_t(MemoryLayout<Int32>.size))
    }

    func send(_ d: [UInt8]) {
        lock.lock(); defer { lock.unlock() }
        var off = 0
        while off < d.count {
            let n = d.withUnsafeBufferPointer { p in
                Darwin.write(fd, p.baseAddress! + off, d.count - off)
            }
            if n <= 0 { fail("Conexão encerrada pela TV", 2) }
            off += n
        }
        bytes += d.count
    }
}

// MARK: - Codificador H.264 (hardware)

final class Encoder: @unchecked Sendable {
    private var session: VTCompressionSession?
    private let sink: Sink
    var encoded = 0
    private static let startCode: [UInt8] = [0, 0, 0, 1]
    // Access Unit Delimiter: avisa a TV que o quadro terminou, para exibir sem esperar o próximo
    private static let aud: [UInt8] = [0, 0, 0, 1, 0x09, 0xF0]

    init(sink: Sink) {
        self.sink = sink
        var s: VTCompressionSession?
        let lowLatency = [kVTVideoEncoderSpecification_EnableLowLatencyRateControl as String: true] as CFDictionary
        var st = VTCompressionSessionCreate(allocator: nil, width: Int32(W), height: Int32(H),
                                            codecType: kCMVideoCodecType_H264,
                                            encoderSpecification: lowLatency, imageBufferAttributes: nil,
                                            compressedDataAllocator: nil, outputCallback: nil, refcon: nil,
                                            compressionSessionOut: &s)
        if st != noErr || s == nil {
            st = VTCompressionSessionCreate(allocator: nil, width: Int32(W), height: Int32(H),
                                            codecType: kCMVideoCodecType_H264,
                                            encoderSpecification: nil, imageBufferAttributes: nil,
                                            compressedDataAllocator: nil, outputCallback: nil, refcon: nil,
                                            compressionSessionOut: &s)
        }
        guard st == noErr, let sess = s else { fail("Não consegui iniciar o codificador H.264 (\(st))", 1) }
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_High_AutoLevel)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AverageBitRate, value: BR as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: FPS as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: (FPS * 2) as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 2 as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(sess)
        session = sess
    }

    func encode(_ pb: CVPixelBuffer, pts: CMTime) {
        guard let sess = session else { return }
        VTCompressionSessionEncodeFrame(sess, imageBuffer: pb, presentationTimeStamp: pts,
                                        duration: .invalid, frameProperties: nil,
                                        infoFlagsOut: nil) { [weak self] status, _, sb in
            guard status == noErr, let sb = sb, let self = self else { return }
            self.emit(sb)
        }
    }

    func finish() {
        if let s = session { VTCompressionSessionCompleteFrames(s, untilPresentationTimeStamp: .invalid) }
    }

    private func emit(_ sb: CMSampleBuffer) {
        var out: [UInt8] = []
        var key = true
        if let a = firstAttachment(sb), let notSync = a[kCMSampleAttachmentKey_NotSync as String] as? Bool, notSync {
            key = false
        }
        // Quadro-chave: manda SPS/PPS antes (a TV precisa deles para começar a decodificar)
        if key, let fmt = CMSampleBufferGetFormatDescription(sb) {
            var count = 0
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0,
                parameterSetPointerOut: nil, parameterSetSizeOut: nil,
                parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
            for i in 0..<count {
                var p: UnsafePointer<UInt8>?
                var size = 0
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i,
                        parameterSetPointerOut: &p, parameterSetSizeOut: &size,
                        parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let p = p {
                    out += Encoder.startCode
                    out += Array(UnsafeBufferPointer(start: p, count: size))
                }
            }
        }
        // Converte AVCC (tamanho de 4 bytes) para Annex B (start codes)
        guard let bb = CMSampleBufferGetDataBuffer(sb) else { return }
        let total = CMBlockBufferGetDataLength(bb)
        var buf = [UInt8](repeating: 0, count: total)
        guard CMBlockBufferCopyDataBytes(bb, atOffset: 0, dataLength: total, destination: &buf) == kCMBlockBufferNoErr else { return }
        var i = 0
        while i + 4 <= total {
            let len = Int(buf[i]) << 24 | Int(buf[i + 1]) << 16 | Int(buf[i + 2]) << 8 | Int(buf[i + 3])
            i += 4
            if len <= 0 || i + len > total { break }
            out += Encoder.startCode
            out += buf[i..<(i + len)]
            i += len
        }
        out += Encoder.aud
        sink.send(out)
        encoded += 1
    }
}

// MARK: - Captura (ScreenCaptureKit)

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let queue = DispatchQueue(label: "lumencap.capture")
    private let encoder: Encoder
    private var last: CVPixelBuffer?
    private var lastAt: TimeInterval = 0
    private let t0 = ProcessInfo.processInfo.systemUptime
    private var timer: DispatchSourceTimer?
    var captured = 0

    init(encoder: Encoder) { self.encoder = encoder }

    private func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
    private func pts() -> CMTime { CMTime(seconds: now() - t0, preferredTimescale: 1_000_000) }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, CMSampleBufferIsValid(sb) else { return }
        // Só quadros completos (o ScreenCaptureKit também manda avisos de "tela parada")
        if let a = firstAttachment(sb), let raw = a[SCStreamFrameInfo.status.rawValue] as? Int,
           let status = SCFrameStatus(rawValue: raw), status != .complete {
            return
        }
        guard let pb = CMSampleBufferGetImageBuffer(sb) else { return }
        last = pb
        lastAt = now()
        captured += 1
        encoder.encode(pb, pts: pts())
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fail("Captura interrompida pelo macOS: \(error.localizedDescription)", 3)
    }

    /** Com a tela parada (slide estático) o macOS não manda quadros: reenviamos o último 2x por segundo. */
    func startRepeater() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 0.5, repeating: 0.5)
        t.setEventHandler { [weak self] in
            guard let self = self, let pb = self.last else { return }
            if self.now() - self.lastAt > 0.45 { self.encoder.encode(pb, pts: self.pts()) }
        }
        t.resume()
        timer = t
    }
}

// MARK: - Principal

@main
struct LumenCap {
    static func main() async {
        signal(SIGPIPE, SIG_IGN)
        // Inicializa a conexão com o servidor de janelas (necessário para o ScreenCaptureKit numa ferramenta de terminal)
        _ = NSApplication.shared
        _ = CGMainDisplayID()
        step("pedindo a lista de telas ao macOS")

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            fail("SEM_PERMISSAO: o macOS não liberou a Gravação de Tela (\(error.localizedDescription))", 3)
        }

        if listOnly {
            for (i, d) in content.displays.enumerated() { print("\(i + 1): \(d.width)x\(d.height)") }
            exit(0)
        }
        guard displayN >= 1 else { fail("Número de tela inválido", 4) }
        let display: SCDisplay
        var virtualDisplay: CGVirtualDisplay? = nil
        if displayN <= content.displays.count {
            display = content.displays[displayN - 1]
        } else {
            // Não existe essa tela: cria um monitor virtual para a TV (tela estendida)
            say("Criando a tela virtual \"Lumen Cast (TV)\" (\(W)x\(H)) para usar a TV como monitor estendido…")
            let desc = CGVirtualDisplayDescriptor()
            desc.queue = DispatchQueue(label: "lumencap.vdisplay")
            desc.name = "Lumen Cast (TV)"
            desc.maxPixelsWide = UInt32(W)
            desc.maxPixelsHigh = UInt32(H)
            desc.sizeInMillimeters = CGSize(width: 1210, height: 680)
            desc.productID = 0x4C43
            desc.vendorID = 0x1E6D
            desc.serialNum = 1
            desc.terminationHandler = { _, _ in }
            guard let vd = CGVirtualDisplay(descriptor: desc) else { fail("O macOS recusou criar a tela virtual", 4) }
            let settings = CGVirtualDisplaySettings()
            settings.hiDPI = 0
            settings.modes = [CGVirtualDisplayMode(width: UInt32(W), height: UInt32(H), refreshRate: 60)]
            if !vd.applySettings(settings) { fail("O macOS recusou criar a tela virtual", 4) }
            virtualDisplay = vd
            let wantedID = vd.displayID
            step("tela virtual criada (id \(wantedID)), aguardando o macOS reconhecê-la")
            var found: SCDisplay? = nil
            for _ in 0..<40 {
                try? await Task.sleep(nanoseconds: 250_000_000)
                if let c = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true),
                   let d = c.displays.first(where: { $0.displayID == wantedID }) { found = d; break }
            }
            guard let f = found else { fail("A tela virtual não apareceu para captura", 4) }
            display = f
            say("Tela estendida pronta: arraste janelas para a direita, ou no Keynote/PowerPoint escolha apresentar nela.")
        }
        step("tela \(displayN): \(display.width)x\(display.height)")

        let cfg = SCStreamConfiguration()
        cfg.width = W
        cfg.height = H
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(FPS))
        cfg.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        cfg.showsCursor = true
        cfg.queueDepth = 6
        cfg.backgroundColor = CGColor.black
        if #available(macOS 14.0, *) {
            cfg.preservesAspectRatio = true
            cfg.scalesToFit = true
        }

        step("abrindo saída")
        let sink = Sink()
        step("criando codificador")
        let encoder = Encoder(sink: sink)
        step("iniciando captura")
        let capture = Capture(encoder: encoder)
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: cfg, delegate: capture)
        do {
            try stream.addStreamOutput(capture, type: .screen, sampleHandlerQueue: capture.queue)
            try await stream.startCapture()
        } catch {
            fail("SEM_PERMISSAO: não consegui iniciar a captura (\(error.localizedDescription))", 3)
        }
        capture.startRepeater()
        say("CAPTURANDO tela \(displayN) (\(display.width)x\(display.height)) → \(W)x\(H) @ \(FPS)fps")

        let stats = DispatchSource.makeTimerSource(queue: .global())
        stats.schedule(deadline: .now() + 1, repeating: 1)
        stats.setEventHandler {
            FileHandle.standardError.write(String(format: "\r   quadros capturados: %d · enviados: %d · %.1f MB   ",
                capture.captured, encoder.encoded, Double(sink.bytes) / 1_048_576).data(using: .utf8)!)
        }
        stats.resume()

        if seconds > 0 {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            try? await stream.stopCapture()
            encoder.finish()
            _ = virtualDisplay
            say("\nOK")
            exit(0)
        }
        while true {
            try? await Task.sleep(nanoseconds: 3_600_000_000_000)
            _ = virtualDisplay
        }

    }
}
