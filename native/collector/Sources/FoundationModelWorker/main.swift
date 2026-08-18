import Foundation
import Darwin
import FoundationModelProtocol

#if canImport(FoundationModels)
import FoundationModels
#endif

@main
private enum FoundationModelWorker {
    static func main() async {
        do {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            let request = try FoundationModelWorkerCoding.decodeRequest(data)
            let response = try await handle(request)
            try write(response)
        } catch {
            try? write(.failure(String(describing: error)))
            exit(EXIT_FAILURE)
        }
    }

    private static func write(_ response: FoundationModelWorkerResponse) throws {
        let data = try FoundationModelWorkerCoding.encodeResponse(response)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    private static func handle(_ request: FoundationModelWorkerRequest) async throws -> FoundationModelWorkerResponse {
#if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            let availability = modelAvailability()
            if request.operation == "availability" {
                return .status(
                    available: availability.available,
                    reason: availability.reason,
                    reasonCode: availability.reasonCode
                )
            }
            guard availability.available else {
                return .failure(availability.reason ?? "Apple's on-device model is unavailable.")
            }
            guard let instructions = request.instructions, let input = request.input else {
                return .failure("The generation request is incomplete.")
            }
            let started = ContinuousClock.now
            let output = try await generate(
                operation: request.operation,
                instructions: instructions,
                input: input,
                maximumResponseTokens: request.effectiveMaximumResponseTokens,
                adapterPath: request.adapterPath
            )
            let elapsed = started.duration(to: .now)
            let components = elapsed.components
            let milliseconds = Int(components.seconds * 1_000) + Int(components.attoseconds / 1_000_000_000_000_000)
            return .success(output: output, durationMilliseconds: milliseconds)
        }
        let version = ProcessInfo.processInfo.operatingSystemVersion
        let currentVersion = "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        let versionReason = "This Mac is running macOS \(currentVersion). Apple On-Device requires macOS 26 or later."
        return request.operation == "availability"
            ? .status(
                available: false,
                reason: versionReason,
                reasonCode: .unsupportedOperatingSystem
            )
            : .failure(versionReason)
#else
        return request.operation == "availability"
            ? .status(
                available: false,
                reason: "This build was compiled without the Foundation Models framework. Build with Xcode 26 or later.",
                reasonCode: .foundationModelsFrameworkMissing
            )
            : .failure("This build was compiled without the Foundation Models framework. Build with Xcode 26 or later.")
#endif
    }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
private func modelAvailability() -> (
    available: Bool,
    reason: String?,
    reasonCode: FoundationModelUnavailabilityReason?
) {
    switch SystemLanguageModel.default.availability {
    case .available:
        return (true, nil, nil)
    case .unavailable(.appleIntelligenceNotEnabled):
        return (false, "Apple Intelligence is turned off on this Mac.", .appleIntelligenceNotEnabled)
    case .unavailable(.deviceNotEligible):
        return (false, "This Mac does not support Apple Intelligence.", .deviceNotEligible)
    case .unavailable(.modelNotReady):
        return (false, "Apple Intelligence is still preparing its on-device model.", .modelNotReady)
    case .unavailable:
        return (false, "Apple's on-device model is unavailable.", .foundationModelsUnavailable)
    }
}

@available(macOS 26.0, *)
@Generable
private struct TimelineGeneration: Encodable {
    @Guide(description: "A 4 to 10 word title beginning with a concrete past-tense verb. Never use a date, time range, application list, or telemetry label as the title.")
    var title: String
    @Guide(description: "One or two factual sentences about the meaningful user action or result, not event telemetry.")
    var description: String
    @Guide(description: "Concrete user workstreams supported by direct action, not applications or event types.", .maximumCount(6))
    var workThreads: [String]
    @Guide(description: "Explicit choices or requested targets only, not clicks, event labels, or implementation claims.", .maximumCount(6))
    var decisions: [String]
    @Guide(description: "Demonstrated results only. Empty when no result is proven.", .maximumCount(6))
    var outcomes: [String]
    @Guide(description: "Explicit impediments only. Empty when none is supported.", .maximumCount(6))
    var blockers: [String]
    @Guide(description: "Files, documents, configurations, or durable work objects directly edited or configured. Never applications or telemetry.", .maximumCount(8))
    var surfaces: [String]
}

@available(macOS 26.0, *)
@Generable
private struct TimelineNarrativeGeneration: Encodable {
    @Guide(description: "A natural-language heading of 3 to 10 words naming the meaningful action, work object, or topic. It may be verb-led, object-led, or topic-led. Never output a date, time range, application list, telemetry label, schema name, type name, or property name as the title.")
    var title: String
    @Guide(description: "One or two factual sentences about the meaningful user action or demonstrated result. Preserve the evidence-supported state without turning editing or a request into completion. Do not narrate telemetry.")
    var description: String
}

@available(macOS 26.0, *)
@Generable
private struct TimelineNarrativePartsGeneration: Encodable {
    @Guide(description: "Choose the evidence-calibrated past-tense lead verb. Follow the preferred title verbs in the input and never exceed its maximum supported state.", .anyOf(["Displayed", "Clicked", "Selected", "Opened", "Navigated", "Viewed", "Explored", "Drafted", "Revised", "Specified", "Edited", "Registered", "Built", "Verified", "Saved"]))
    var action: String
    @Guide(description: "A concrete 3 to 8 word subject naming what was drafted, revised, selected, displayed, or demonstrated. Never use an application name by itself, telemetry, a timestamp, or another verb as the whole subject.")
    var subject: String
    @Guide(description: "One or two factual sentences. State the central meaningful action first, then preserve up to three concrete supported details, especially the newest final-state evidence. Do not claim implementation or completion from a request.")
    var description: String
}

@available(macOS 26.0, *)
@Generable
private struct HourGeneration: Encodable {
    @Guide(description: "A 4 to 10 word title beginning with a concrete past-tense verb. Never use a date, time range, or application list.")
    var title: String
    @Guide(description: "One to four newline-separated bullets, each beginning with '- '.")
    var summary: String
    @Guide(description: "Concrete workstreams, not applications or event types.", .maximumCount(6)) var workThreads: [String]
    @Guide(description: "Explicit choices or requested targets only.", .maximumCount(6)) var decisions: [String]
    @Guide(description: "Demonstrated results only.", .maximumCount(6)) var outcomes: [String]
    @Guide(description: "Explicit impediments only.", .maximumCount(6)) var blockers: [String]
    @Guide(description: "Durable work objects directly edited or configured.", .maximumCount(8)) var surfaces: [String]
    @Guide(description: "Opaque candidate link references whose exact labels appear in the summary. Never invent a reference.", .maximumCount(5)) var linkReferences: [String]
}

@available(macOS 26.0, *)
@Generable
private struct HourNarrativeGeneration: Encodable {
    @Guide(description: "A specific 4 to 10 word title beginning with a concrete evidence-calibrated past-tense verb and naming the dominant workstream or demonstrated result.")
    var title: String
    @Guide(description: "One to four concise newline-separated bullets, each beginning with '- '. Preserve materially distinct work, requested-versus-completed state, supported decisions, demonstrated results, and important blockers. Most important first.")
    var summary: String
    @Guide(description: "Opaque candidate link references whose exact labels appear in the summary. Never invent a reference.", .maximumCount(5))
    var linkReferences: [String]
}

@available(macOS 26.0, *)
@Generable
private struct DayGeneration: Encodable {
    @Guide(description: "A 4 to 10 word title beginning with a concrete past-tense verb. Never use a date or application list.")
    var title: String
    @Guide(description: "Two to five newline-separated bullets, each beginning with '- '.")
    var summary: String
    @Guide(.maximumCount(8)) var themes: [String]
    @Guide(.maximumCount(8)) var accomplishments: [String]
    @Guide(.maximumCount(8)) var decisions: [String]
    @Guide(description: "Work explicitly supported as unfinished or blocked in the current day's evidence.", .maximumCount(8)) var unfinishedWork: [String]
    @Guide(.maximumCount(8)) var recurringPatterns: [String]
    @Guide(description: "Opaque candidate link references whose exact labels appear in the summary. Never invent a reference.", .maximumCount(5)) var linkReferences: [String]
}

@available(macOS 26.0, *)
@Generable
private struct DayNarrativeGeneration: Encodable {
    @Guide(description: "A specific 4 to 10 word title beginning with a concrete evidence-calibrated past-tense verb and naming the day's dominant workstream or demonstrated result.")
    var title: String
    @Guide(description: "Two to five concise newline-separated bullets, each beginning with '- '. Organize by meaningful workstream, preserve requested-versus-completed state, and prioritize demonstrated results, consequential decisions, and important unfinished work.")
    var summary: String
    @Guide(description: "Opaque candidate link references whose exact labels appear in the summary. Never invent a reference.", .maximumCount(5))
    var linkReferences: [String]
}

@available(macOS 26.0, *)
private func generate(
    operation: String,
    instructions: String,
    input: String,
    maximumResponseTokens: Int,
    adapterPath: String?
) async throws -> String {
    let model = try languageModel(adapterPath: adapterPath)
    let session = LanguageModelSession(model: model, instructions: instructions)
    let options = GenerationOptions(
        sampling: .greedy,
        maximumResponseTokens: maximumResponseTokens
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]

    switch operation {
    case "hour_rollup_compact":
        let response = try await session.respond(to: input, generating: HourNarrativeGeneration.self, options: options)
        let value = response.content
        return try jsonString([
            "title": value.title,
            "summary": value.summary,
            "workThreads": [],
            "decisions": [],
            "outcomes": [],
            "blockers": [],
            "surfaces": [],
            "linkReferences": value.linkReferences
        ])
    case "daily_rollup_compact":
        let response = try await session.respond(to: input, generating: DayNarrativeGeneration.self, options: options)
        let value = response.content
        return try jsonString([
            "title": value.title,
            "summary": value.summary,
            "themes": [],
            "accomplishments": [],
            "decisions": [],
            "unfinishedWork": [],
            "recurringPatterns": [],
            "linkReferences": value.linkReferences
        ])
    case "timeline_entry_compact_parts":
        let response = try await session.respond(to: input, generating: TimelineNarrativePartsGeneration.self, options: options)
        let value = response.content
        return try jsonString([
            "title": "\(value.action) \(value.subject)",
            "description": value.description,
            "workThreads": [],
            "decisions": [],
            "outcomes": [],
            "blockers": [],
            "surfaces": [],
            "suggestion": NSNull()
        ])
    case "timeline_entry_compact":
        let response = try await session.respond(
            to: input,
            generating: TimelineNarrativeGeneration.self,
            includeSchemaInPrompt: adapterPath == nil,
            options: options
        )
        let value = response.content
        return try jsonString([
            "title": value.title,
            "description": value.description,
            "workThreads": [],
            "decisions": [],
            "outcomes": [],
            "blockers": [],
            "surfaces": [],
            "suggestion": NSNull()
        ])
    case "timeline_entry":
        let response = try await session.respond(to: input, generating: TimelineGeneration.self, options: options)
        let value = response.content
        return try jsonString([
            "title": value.title,
            "description": value.description,
            "workThreads": value.workThreads,
            "decisions": value.decisions,
            "outcomes": value.outcomes,
            "blockers": value.blockers,
            "surfaces": value.surfaces,
            "suggestion": NSNull()
        ])
    case "hour_rollup":
        let response = try await session.respond(to: input, generating: HourGeneration.self, options: options)
        return try encode(response.content, using: encoder)
    case "daily_rollup":
        let response = try await session.respond(to: input, generating: DayGeneration.self, options: options)
        return try encode(response.content, using: encoder)
    default:
        throw WorkerError.unsupportedOperation(operation)
    }
}

@available(macOS 26.0, *)
private func languageModel(adapterPath: String?) throws -> SystemLanguageModel {
    guard let adapterPath, !adapterPath.isEmpty else { return .default }
    guard FileManager.default.fileExists(atPath: adapterPath) else {
        throw WorkerError.adapterNotFound(adapterPath)
    }
    let adapter = try SystemLanguageModel.Adapter(fileURL: URL(fileURLWithPath: adapterPath))
    return SystemLanguageModel(adapter: adapter)
}

@available(macOS 26.0, *)
private func encode<T: Encodable>(_ value: T, using encoder: JSONEncoder) throws -> String {
    guard let string = String(data: try encoder.encode(value), encoding: .utf8) else {
        throw WorkerError.invalidOutput
    }
    return string
}

private func jsonString(_ value: [String: Any]) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    guard let string = String(data: data, encoding: .utf8) else { throw WorkerError.invalidOutput }
    return string
}
#endif

private enum WorkerError: Error {
    case adapterNotFound(String)
    case invalidOutput
    case unsupportedOperation(String)
}
