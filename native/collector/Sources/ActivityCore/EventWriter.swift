import Foundation

public final class EventWriter: @unchecked Sendable {
    private let directory: URL
    private let encoder: JSONEncoder
    private let lock = NSLock()
    private var openFilePath: String?
    private var openFileHandle: FileHandle?
    private let emitToStandardOutput: Bool
    private let eventHandler: (@Sendable (Data) -> Void)?

    public init(
        directory: URL,
        emitToStandardOutput: Bool = true,
        eventHandler: (@Sendable (Data) -> Void)? = nil
    ) throws {
        self.directory = directory
        self.encoder = ActivityEventCoding.makeEncoder()
        self.emitToStandardOutput = emitToStandardOutput
        self.eventHandler = eventHandler
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: directory.path
        )
    }

    public func write(_ event: ActivityEvent) throws {
        let data = try encoder.encode(event)
        var line = data
        line.append(0x0A)

        lock.lock()
        defer { lock.unlock() }

        let fileURL = directory.appendingPathComponent(Self.fileName(for: event.timestamp))
        let handle = try writableHandle(for: fileURL)
        try handle.write(contentsOf: line)

        if emitToStandardOutput { FileHandle.standardOutput.write(line) }
        eventHandler?(line)
    }

    private func writableHandle(for fileURL: URL) throws -> FileHandle {
        if openFilePath == fileURL.path, let openFileHandle { return openFileHandle }

        try? openFileHandle?.close()
        openFilePath = nil
        openFileHandle = nil
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(
                atPath: fileURL.path,
                contents: nil,
                attributes: [.posixPermissions: 0o600]
            )
        }
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fileURL.path
        )
        let handle = try FileHandle(forWritingTo: fileURL)
        try handle.seekToEnd()
        openFilePath = fileURL.path
        openFileHandle = handle
        return handle
    }

    public static func fileName(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return "events-\(formatter.string(from: date)).jsonl"
    }
}
