// diegocap – captura a tela do Mac (ScreenCaptureKit), codifica em H.264 por hardware
// (VideoToolbox) e envia ao Diego Cast no Fire TV. Compilado automaticamente pelo projetar.sh.
//
// Uso: diegocap --host IP [--port 7000] [--display 1] [--width 1920] [--height 1080]
//               [--fps 30] [--bitrate 6000000] [--out arquivo.h264 --seconds 4] [--list]
// Códigos de saída: 2 = conexão perdida, 3 = sem permissão de Gravação de Tela, 4 = tela inválida

import Foundation
import CoreMedia
import CoreVideo
import CoreGraphics
import VideoToolbox
import ScreenCaptureKit
import AppKit
import CryptoKit
import ApplicationServices

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
let controlPort = UInt16(arg("--control-port", "0")) ?? 0
let checkOnly = CommandLine.arguments.contains("--check")
let ignoreSlideKeys = CommandLine.arguments.contains("--no-keys")
/// HEVC (H.265): ~30–40% menos dados que H.264 na mesma qualidade (texto mais nítido). "--codec h264" volta ao anterior.
let useHEVC = arg("--codec", "hevc").lowercased() != "h264"

// MARK: - Segurança (mesmo protocolo do app da TV: SecureChannel.java)
//
// Pareamento: código de 20 caracteres mostrado na TV → master = HKDF-SHA256(código, "DiegoCast-v1", "master").
// Por conexão: "DCS1" | propósito | nonceMac(16) → nonceTV(16) | HMAC(master,"srv"…) → HMAC(master,"cli"…).
// Registros: tamanho(4) | AES-256-GCM(nonce = 0000|contador de 8 bytes, aad = tamanho).

enum Sec {
    static func bytes(_ s: String) -> [UInt8] { Array(s.utf8) }

    static func hkdf(_ ikm: [UInt8], salt: [UInt8], info: [UInt8]) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: ikm), salt: salt, info: info, outputByteCount: 32)
    }

    static func raw(_ k: SymmetricKey) -> [UInt8] { k.withUnsafeBytes { Array($0) } }

    static func hmac(_ key: SymmetricKey, _ data: [UInt8]) -> [UInt8] {
        Array(HMAC<SHA256>.authenticationCode(for: data, using: key))
    }

    static func equal(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        guard a.count == b.count else { return false }
        var d: UInt8 = 0
        for i in 0..<a.count { d |= a[i] ^ b[i] }
        return d == 0
    }

    static func master(fromCode code: String) -> SymmetricKey {
        let norm = code.uppercased().filter { ($0 >= "A" && $0 <= "Z") || ($0 >= "0" && $0 <= "9") }
        return hkdf(bytes(norm), salt: bytes("DiegoCast-v1"), info: bytes("master"))
    }

    static func random(_ n: Int) -> [UInt8] {
        var b = [UInt8](repeating: 0, count: n)
        _ = SecRandomCopyBytes(kSecRandomDefault, n, &b)
        return b
    }
}

/** Lê o código de pareamento da entrada padrão (nunca da linha de comando, onde ficaria visível). */
let pairingCode: String = {
    guard CommandLine.arguments.contains("--key-stdin") else { return "" }
    return readLine(strippingNewline: true) ?? ""
}()

func tcpConnect(_ host: String, _ port: UInt16, timeout: Int = 5) -> Int32? {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    if fd < 0 { return nil }
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    if inet_pton(AF_INET, host, &addr.sin_addr) != 1 { close(fd); return nil }
    let r = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    if r != 0 { close(fd); return nil }
    var tv = timeval(tv_sec: timeout, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
    var one: Int32 = 1
    setsockopt(fd, Int32(IPPROTO_TCP), TCP_NODELAY, &one, socklen_t(MemoryLayout<Int32>.size))
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    return fd
}

func writeAll(_ fd: Int32, _ d: [UInt8]) -> Bool {
    var off = 0
    while off < d.count {
        let n = d.withUnsafeBufferPointer { p in Darwin.write(fd, p.baseAddress! + off, d.count - off) }
        if n <= 0 { return false }
        off += n
    }
    return true
}

func readExact(_ fd: Int32, _ count: Int) -> [UInt8]? {
    var buf = [UInt8](repeating: 0, count: count)
    var off = 0
    while off < count {
        let n = buf.withUnsafeMutableBufferPointer { p in Darwin.read(fd, p.baseAddress! + off, count - off) }
        if n <= 0 { return nil }
        off += n
    }
    return buf
}

enum LinkError: Error { case network, notPaired }

/** Canal autenticado e cifrado com a TV. */
final class SecureLink: @unchecked Sendable {
    let fd: Int32
    private let sendKey: SymmetricKey, recvKey: SymmetricKey
    private var sendCtr: UInt64 = 0, recvCtr: UInt64 = 0

    /// Protocolo v2 ("DCS2"): além do código de pareamento, cada conexão faz uma troca de chaves
    /// ECDH P-256 temporária. As chaves temporárias somem no fim: quem gravar o tráfego não consegue
    /// decifrá-lo depois, mesmo que um dia descubra o código (sigilo futuro).
    init(fd: Int32, purpose: UInt8) throws {
        self.fd = fd
        let master = Sec.master(fromCode: pairingCode)
        let cn = Sec.random(16)
        let eph = P256.KeyAgreement.PrivateKey()
        let macPub = Array(eph.publicKey.x963Representation)          // 65 bytes: 04 | X | Y
        var hello: [UInt8] = Sec.bytes("DCS2")
        hello.append(purpose); hello += cn; hello += macPub
        guard writeAll(fd, hello),
              let resp = readExact(fd, 16 + 65 + 32) else { throw LinkError.network }
        let sn = Array(resp[0..<16]), tvPub = Array(resp[16..<81]), tagS = Array(resp[81..<113])
        var transcript: [UInt8] = [purpose]
        transcript += cn; transcript += sn; transcript += macPub; transcript += tvPub
        // A TV prova que conhece o código ANTES de o Mac mandar qualquer coisa: barra TVs falsas e
        // impede que alguém no meio troque as chaves temporárias.
        guard Sec.equal(tagS, Sec.hmac(master, Sec.bytes("srv2") + transcript)) else { throw LinkError.notPaired }
        guard let peer = try? P256.KeyAgreement.PublicKey(x963Representation: tvPub),
              let secret = try? eph.sharedSecretFromKeyAgreement(with: peer) else { throw LinkError.notPaired }
        guard writeAll(fd, Sec.hmac(master, Sec.bytes("cli2") + transcript)) else { throw LinkError.network }
        let shared: [UInt8] = secret.withUnsafeBytes { Array($0) }
        let ikm = shared + Sec.raw(master)
        sendKey = Sec.hkdf(ikm, salt: cn + sn, info: Sec.bytes("c2s") + [purpose])
        recvKey = Sec.hkdf(ikm, salt: cn + sn, info: Sec.bytes("s2c") + [purpose])
    }

    private static func be32(_ v: Int) -> [UInt8] { [UInt8((v >> 24) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 8) & 0xff), UInt8(v & 0xff)] }

    private static func nonce(_ c: UInt64) -> [UInt8] {
        var n = [UInt8](repeating: 0, count: 12)
        for k in 0..<8 { n[11 - k] = UInt8((c >> (8 * UInt64(k))) & 0xff) }
        return n
    }

    func seal(_ pt: [UInt8]) -> [UInt8]? {
        let hdr = SecureLink.be32(pt.count + 16)
        guard let nonce = try? AES.GCM.Nonce(data: SecureLink.nonce(sendCtr)),
              let box = try? AES.GCM.seal(pt, using: sendKey, nonce: nonce, authenticating: hdr) else { return nil }
        sendCtr += 1
        return hdr + Array(box.ciphertext) + Array(box.tag)
    }

    /** Próximo registro decifrado; nil se a conexão caiu ou o registro foi alterado/reenviado. */
    func readRecord() -> [UInt8]? {
        guard let hdr = readExact(fd, 4) else { return nil }
        let n = Int(hdr[0]) << 24 | Int(hdr[1]) << 16 | Int(hdr[2]) << 8 | Int(hdr[3])
        guard n >= 16, n <= 1 << 20, let ct = readExact(fd, n),
              let nonce = try? AES.GCM.Nonce(data: SecureLink.nonce(recvCtr)),
              let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: ct[0..<(n - 16)], tag: ct[(n - 16)..<n]),
              let pt = try? AES.GCM.open(box, using: recvKey, authenticating: hdr) else { return nil }
        recvCtr += 1
        return Array(pt)
    }
}

// MARK: - Controle remoto da TV → teclas no Mac

/** Recebe (cifrado) os botões do controle do Fire TV e aperta as teclas correspondentes no Mac. */
func startControl(host: String, port: UInt16, onKeyFrameRequest: @escaping @Sendable () -> Void) {
    let opts = ["AXTrustedCheckOptionPrompt": true] as CFDictionary   // = kAXTrustedCheckOptionPrompt
    if !ignoreSlideKeys && !AXIsProcessTrustedWithOptions(opts) {
        say("AVISO_ACESSIBILIDADE: libere o Diego Cast/Terminal em Ajustes → Privacidade e Segurança → Acessibilidade para passar slides pelo controle")
    }
    let keys: [String: CGKeyCode] = ["R": 124, "L": 123, "U": 126, "D": 125, "PLAY": 49]   // só estas teclas
    let t = Thread {
        while true {
            if let fd = tcpConnect(host, port) {
                if let link = try? SecureLink(fd: fd, purpose: UInt8(ascii: "C")) {
                    var tv = timeval(tv_sec: 0, tv_usec: 0)   // sem tempo-limite depois de autenticado
                    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
                    step("controle autenticado")
                    while let rec = link.readRecord() {
                        guard let cmd = String(bytes: rec, encoding: .ascii) else { continue }
                        if cmd == "KEY" { onKeyFrameRequest(); continue }    // a TV precisa de um quadro-chave
                        if cmd == "NOHEVC" { fail("SEM_HEVC: a TV não decodifica HEVC; voltando para H.264", 7) }
                        guard !ignoreSlideKeys, let code = keys[cmd] else { continue }
                        let src = CGEventSource(stateID: .hidSystemState)
                        CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true)?.post(tap: .cghidEventTap)
                        CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)?.post(tap: .cghidEventTap)
                    }
                }
                close(fd)
            }
            Thread.sleep(forTimeInterval: 1.5)
        }
    }
    t.start()
}

func firstAttachment(_ sb: CMSampleBuffer) -> NSDictionary? {
    guard let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false),
          CFArrayGetCount(arr) > 0, let v = CFArrayGetValueAtIndex(arr, 0) else { return nil }
    return unsafeBitCast(v, to: CFDictionary.self) as NSDictionary
}

// MARK: - Saída (TCP para a TV, ou arquivo no modo de teste)

final class Sink: @unchecked Sendable {
    private var fd: Int32 = -1
    private let lock = NSLock()
    private var link: SecureLink?
    var bytes = 0

    init() {
        if !outFile.isEmpty {
            fd = open(outFile, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
            if fd < 0 { fail("Não consegui criar \(outFile)", 1) }
            return
        }
        if pairingCode.isEmpty { fail("NAO_PAREADO: este Mac ainda não foi pareado com a TV", 5) }
        guard let f = tcpConnect(host, port) else { fail("Não conectou em \(host):\(port) (o Diego Cast está aberto na TV?)", 2) }
        fd = f
        do {
            link = try SecureLink(fd: fd, purpose: UInt8(ascii: useHEVC ? "h" : "v"))
        } catch LinkError.notPaired {
            fail("NAO_PAREADO: a TV em \(host) não reconheceu o código (pareie de novo, ou não é a sua TV)", 5)
        } catch {
            fail("A TV não completou o aperto de mão seguro (app da TV desatualizado?)", 6)
        }
        var noTimeout = timeval(tv_sec: 0, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &noTimeout, socklen_t(MemoryLayout<timeval>.size))
        var lowat: Int32 = 64 * 1024   // TCP_NOTSENT_LOWAT (0x201): limita o que fica na fila de envio
        setsockopt(fd, Int32(IPPROTO_TCP), 0x201, &lowat, socklen_t(MemoryLayout<Int32>.size))
        var sndbuf: Int32 = 512 * 1024
        setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &sndbuf, socklen_t(MemoryLayout<Int32>.size))
    }

    func send(_ d: [UInt8], ptsUs: UInt64 = 0) {
        lock.lock(); defer { lock.unlock() }
        var out = d
        if let l = link {                        // em rede: sempre cifrado, com o horário de captura na frente
            var ts = [UInt8](repeating: 0, count: 8)
            for k in 0..<8 { ts[7 - k] = UInt8((ptsUs >> (8 * UInt64(k))) & 0xff) }
            guard let sealed = l.seal(ts + d) else { fail("Falha ao cifrar o vídeo", 1) }
            out = sealed
        }
        if !writeAll(fd, out) { fail("Conexão encerrada pela TV", 2) }
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
    private static let audAVC: [UInt8] = [0, 0, 0, 1, 0x09, 0xF0]
    private static let audHEVC: [UInt8] = [0, 0, 0, 1, 0x46, 0x01, 0x50]   // NAL tipo 35, pic_type 2
    private var nalLengthSize = 4

    init(sink: Sink) {
        self.sink = sink
        var s: VTCompressionSession?
        let lowLatency = [kVTVideoEncoderSpecification_EnableLowLatencyRateControl as String: true] as CFDictionary
        var st = VTCompressionSessionCreate(allocator: nil, width: Int32(W), height: Int32(H),
                                            codecType: useHEVC ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264,
                                            encoderSpecification: lowLatency, imageBufferAttributes: nil,
                                            compressedDataAllocator: nil, outputCallback: nil, refcon: nil,
                                            compressionSessionOut: &s)
        if st != noErr || s == nil {
            st = VTCompressionSessionCreate(allocator: nil, width: Int32(W), height: Int32(H),
                                            codecType: useHEVC ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264,
                                            encoderSpecification: nil, imageBufferAttributes: nil,
                                            compressedDataAllocator: nil, outputCallback: nil, refcon: nil,
                                            compressionSessionOut: &s)
        }
        guard st == noErr, let sess = s else { fail("Não consegui iniciar o codificador \(useHEVC ? "HEVC" : "H.264") (\(st))", 1) }
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ProfileLevel,
                             value: useHEVC ? kVTProfileLevel_HEVC_Main_AutoLevel : kVTProfileLevel_H264_High_AutoLevel)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AverageBitRate, value: BR as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: FPS as CFNumber)
        // Quadro-chave a cada 5 s só por segurança: a TV pede um na hora quando precisa (menos picos = sem travadas)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: (FPS * 5) as CFNumber)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 5 as CFNumber)
        // Não segura quadros dentro do codificador (cada quadro sai assim que é codificado)
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxFrameDelayCount, value: 0 as CFNumber)
        if #available(macOS 13.0, *) {
            VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality, value: kCFBooleanTrue)
        }
        // Evita picos de dados (que travam o Wi‑Fi e a TV): no máximo 1,5x a taxa média em qualquer segundo
        let limits = [NSNumber(value: Double(BR) / 8.0 * 1.5), NSNumber(value: 1.0)] as CFArray
        VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_DataRateLimits, value: limits)
        VTCompressionSessionPrepareToEncodeFrames(sess)
        session = sess
    }

    private let keyLock = NSLock()
    private var wantKey = false
    private var lastForced = 0.0

    /** Chamado quando a TV pede um quadro-chave (no máx. ~3 por segundo). */
    func requestKeyFrame() {
        keyLock.lock(); defer { keyLock.unlock() }
        let now = ProcessInfo.processInfo.systemUptime
        if now - lastForced < 0.3 { return }
        lastForced = now
        wantKey = true
    }

    func encode(_ pb: CVPixelBuffer, pts: CMTime) {
        guard let sess = session else { return }
        keyLock.lock()
        let force = wantKey
        wantKey = false
        keyLock.unlock()
        let props: CFDictionary? = force
            ? ([kVTEncodeFrameOptionKey_ForceKeyFrame as String: true] as CFDictionary) : nil
        VTCompressionSessionEncodeFrame(sess, imageBuffer: pb, presentationTimeStamp: pts,
                                        duration: .invalid, frameProperties: props,
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
            var hdrLen: Int32 = 4
            if useHEVC {
                CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(fmt, parameterSetIndex: 0,
                    parameterSetPointerOut: nil, parameterSetSizeOut: nil,
                    parameterSetCountOut: &count, nalUnitHeaderLengthOut: &hdrLen)
            } else {
                CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0,
                    parameterSetPointerOut: nil, parameterSetSizeOut: nil,
                    parameterSetCountOut: &count, nalUnitHeaderLengthOut: &hdrLen)
            }
            if hdrLen >= 1 && hdrLen <= 4 { nalLengthSize = Int(hdrLen) }
            for i in 0..<count {
                var p: UnsafePointer<UInt8>?
                var size = 0
                let st = useHEVC
                    ? CMVideoFormatDescriptionGetHEVCParameterSetAtIndex(fmt, parameterSetIndex: i,
                        parameterSetPointerOut: &p, parameterSetSizeOut: &size,
                        parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil)
                    : CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i,
                        parameterSetPointerOut: &p, parameterSetSizeOut: &size,
                        parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil)
                if st == noErr, let p = p {
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
        let L = nalLengthSize
        while i + L <= total {
            var len = 0
            for k in 0..<L { len = (len << 8) | Int(buf[i + k]) }
            i += L
            if len <= 0 || i + len > total { break }
            out += Encoder.startCode
            out += buf[i..<(i + len)]
            i += len
        }
        out += useHEVC ? Encoder.audHEVC : Encoder.audAVC
        let t = CMSampleBufferGetPresentationTimeStamp(sb)
        let us = t.isValid ? UInt64(max(0, t.seconds) * 1_000_000) : 0
        sink.send(out, ptsUs: us)
        encoded += 1
    }
}

// MARK: - Captura (ScreenCaptureKit)

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let queue = DispatchQueue(label: "diegocap.capture")
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
struct DiegoCap {
    static func main() async {
        signal(SIGPIPE, SIG_IGN)
        // Inicializa a conexão com o servidor de janelas (necessário para o ScreenCaptureKit numa ferramenta de terminal)
        _ = NSApplication.shared
        _ = CGMainDisplayID()
        if checkOnly {
            // Só testa o pareamento (usado pelo --parear): aperto de mão no canal de controle
            guard let fd = tcpConnect(host, controlPort == 0 ? 7002 : controlPort) else { fail("Não conectou na TV em \(host)", 2) }
            if pairingCode.count < 20 { close(fd); fail("Código vazio ou incompleto (\(pairingCode.count) caracteres recebidos)", 5) }
            do { _ = try SecureLink(fd: fd, purpose: UInt8(ascii: "C")); close(fd); say("PAREAMENTO_OK"); exit(0) }
            catch LinkError.notPaired { close(fd); fail("NAO_PAREADO: a TV respondeu, mas o código não confere", 5) }
            catch { close(fd); fail("A TV não respondeu ao aperto de mão seguro (app da TV antigo?)", 6) }
        }
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
            say("Criando a tela virtual \"Diego Cast (TV)\" (\(W)x\(H)) para usar a TV como monitor estendido…")
            let desc = CGVirtualDisplayDescriptor()
            desc.queue = DispatchQueue(label: "diegocap.vdisplay")
            desc.name = "Diego Cast (TV)"
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
        cfg.queueDepth = 8
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
        if controlPort != 0 && outFile.isEmpty {
            startControl(host: host, port: controlPort) { encoder.requestKeyFrame() }
        }
        say("CODEC \(useHEVC ? "HEVC" : "H.264")")
        say("CAPTURANDO tela \(displayN) (\(display.width)x\(display.height)) → \(W)x\(H) @ \(FPS)fps")

        let stats = DispatchSource.makeTimerSource(queue: .global())
        stats.schedule(deadline: .now() + 1, repeating: 1)
        var lastEncoded = 0
        var lastBytes = 0
        stats.setEventHandler {
            let e = encoder.encoded, b = sink.bytes
            let fps = e - lastEncoded
            let mbps = Double(b - lastBytes) * 8 / 1_000_000
            lastEncoded = e; lastBytes = b
            FileHandle.standardError.write(String(format: "\r   %2d fps · %4.1f Mbit/s · quadros enviados: %d · %.1f MB   ",
                fps, mbps, e, Double(b) / 1_048_576).data(using: .utf8)!)
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
