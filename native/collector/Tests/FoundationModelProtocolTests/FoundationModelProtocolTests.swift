import Foundation
import Testing
@testable import FoundationModelProtocol

@Test func decodesTheExistingWorkerRequestWireFormat() throws {
    let data = Data(#"{"operation":"timeline_entry_compact","instructions":"Summarize","input":"Synthetic evidence","maximumResponseTokens":550,"adapterPath":"/private/tmp/test.fmadapter"}"#.utf8)
    let request = try FoundationModelWorkerCoding.decodeRequest(data)

    #expect(request.operation == "timeline_entry_compact")
    #expect(request.recognizedOperation == .timelineEntryCompact)
    #expect(request.instructions == "Summarize")
    #expect(request.input == "Synthetic evidence")
    #expect(request.effectiveMaximumResponseTokens == 550)
    #expect(request.adapterPath == "/private/tmp/test.fmadapter")
    #expect(request.hasCompleteGenerationInput)
}

@Test func keepsAvailabilityAndGenerationDefaultsBackwardCompatible() throws {
    let request = try FoundationModelWorkerCoding.decodeRequest(Data(#"{"operation":"availability"}"#.utf8))
    #expect(request.recognizedOperation == .availability)
    #expect(request.effectiveMaximumResponseTokens == 600)
    #expect(request.adapterPath == nil)
    #expect(!request.hasCompleteGenerationInput)
}

@Test func preservesUnknownOperationsForTheWorkerErrorPath() throws {
    let request = try FoundationModelWorkerCoding.decodeRequest(Data(#"{"operation":"future_operation","instructions":"x","input":"y"}"#.utf8))
    #expect(request.operation == "future_operation")
    #expect(request.recognizedOperation == nil)
}

@Test func encodesSuccessFailureAndAvailabilityWithoutChangingKeys() throws {
    let responses: [FoundationModelWorkerResponse] = [
        .status(available: false, reason: "Model is unavailable."),
        .success(output: #"{"title":"Synthetic"}"#, durationMilliseconds: 42),
        .failure("Synthetic failure")
    ]

    let objects = try responses.map { response in
        try #require(JSONSerialization.jsonObject(with: FoundationModelWorkerCoding.encodeResponse(response)) as? [String: Any])
    }
    #expect(objects[0]["ok"] as? Bool == true)
    #expect(objects[0]["available"] as? Bool == false)
    #expect(objects[0]["reason"] as? String == "Model is unavailable.")
    #expect(objects[1]["output"] as? String == #"{"title":"Synthetic"}"#)
    #expect(objects[1]["durationMilliseconds"] as? Int == 42)
    #expect(objects[2]["ok"] as? Bool == false)
    #expect(objects[2]["reason"] as? String == "Synthetic failure")
}

@Test func listsEveryProductionOperationName() {
    #expect(Set(FoundationModelOperation.allCases.map(\.rawValue)) == [
        "availability",
        "timeline_entry",
        "timeline_entry_compact",
        "timeline_entry_compact_parts",
        "hour_rollup",
        "hour_rollup_compact",
        "daily_rollup",
        "daily_rollup_compact"
    ])
}
