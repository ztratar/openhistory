import Foundation

public enum FoundationModelOperation: String, CaseIterable, Codable, Sendable {
    case availability
    case timelineEntry = "timeline_entry"
    case timelineEntryCompact = "timeline_entry_compact"
    case timelineEntryCompactParts = "timeline_entry_compact_parts"
    case hourRollup = "hour_rollup"
    case hourRollupCompact = "hour_rollup_compact"
    case dailyRollup = "daily_rollup"
    case dailyRollupCompact = "daily_rollup_compact"
}

public struct FoundationModelWorkerRequest: Codable, Equatable, Sendable {
    public let operation: String
    public let instructions: String?
    public let input: String?
    public let maximumResponseTokens: Int?
    public let adapterPath: String?

    public init(
        operation: String,
        instructions: String? = nil,
        input: String? = nil,
        maximumResponseTokens: Int? = nil,
        adapterPath: String? = nil
    ) {
        self.operation = operation
        self.instructions = instructions
        self.input = input
        self.maximumResponseTokens = maximumResponseTokens
        self.adapterPath = adapterPath
    }

    public var recognizedOperation: FoundationModelOperation? {
        FoundationModelOperation(rawValue: operation)
    }

    public var effectiveMaximumResponseTokens: Int {
        maximumResponseTokens ?? 600
    }

    public var hasCompleteGenerationInput: Bool {
        instructions != nil && input != nil
    }
}

public struct FoundationModelWorkerResponse: Codable, Equatable, Sendable {
    public let ok: Bool
    public let available: Bool?
    public let reason: String?
    public let output: String?
    public let durationMilliseconds: Int?

    public init(
        ok: Bool,
        available: Bool? = nil,
        reason: String? = nil,
        output: String? = nil,
        durationMilliseconds: Int? = nil
    ) {
        self.ok = ok
        self.available = available
        self.reason = reason
        self.output = output
        self.durationMilliseconds = durationMilliseconds
    }

    public static func status(available: Bool, reason: String? = nil) -> Self {
        Self(ok: true, available: available, reason: reason)
    }

    public static func success(output: String, durationMilliseconds: Int) -> Self {
        Self(ok: true, available: true, output: output, durationMilliseconds: durationMilliseconds)
    }

    public static func failure(_ reason: String) -> Self {
        Self(ok: false, reason: reason)
    }
}

public enum FoundationModelWorkerCoding {
    public static func decodeRequest(_ data: Data) throws -> FoundationModelWorkerRequest {
        try JSONDecoder().decode(FoundationModelWorkerRequest.self, from: data)
    }

    public static func encodeResponse(_ response: FoundationModelWorkerResponse) throws -> Data {
        try JSONEncoder().encode(response)
    }
}
