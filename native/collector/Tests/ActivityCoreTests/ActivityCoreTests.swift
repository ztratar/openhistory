import Foundation
import Testing
@testable import ActivityCore

@Test func eventEncodingUsesTheSharedWireFormat() throws {
    let event = ActivityEvent(
        id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
        timestamp: Date(timeIntervalSince1970: 0),
        kind: .applicationActivated,
        application: ApplicationDescriptor(
            bundleIdentifier: "com.example.Editor",
            localizedName: "Editor",
            processIdentifier: 42
        ),
        windowTitle: "Prototype"
    )

    let data = try ActivityEventCoding.makeEncoder().encode(event)
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

    #expect(object["version"] as? Int == 1)
    #expect(object["kind"] as? String == "application_activated")
    #expect(object["windowTitle"] as? String == "Prototype")
}

@Test func eventFilesArePartitionedByLocalDay() {
    let date = Date(timeIntervalSince1970: 0)
    #expect(EventWriter.fileName(for: date).hasPrefix("events-"))
    #expect(EventWriter.fileName(for: date).hasSuffix(".jsonl"))
}

@Test func eventWriterRestrictsRawActivityToTheCurrentUser() throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("openhistory-permissions-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let writer = try EventWriter(directory: directory)
    let event = ActivityEvent(timestamp: Date(timeIntervalSince1970: 0), kind: .collectorStarted)
    try writer.write(event)

    let directoryMode = try #require(
        FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as? NSNumber
    )
    let eventPath = directory.appendingPathComponent(EventWriter.fileName(for: event.timestamp)).path
    let eventMode = try #require(
        FileManager.default.attributesOfItem(atPath: eventPath)[.posixPermissions] as? NSNumber
    )
    #expect(directoryMode.intValue == 0o700)
    #expect(eventMode.intValue == 0o600)
}

@Test func collectorStartupEncodesSemanticCapabilityState() throws {
    let event = ActivityEvent(
        kind: .collectorStarted,
        accessibilityTrusted: true,
        pointerCaptureAvailable: true
    )
    let data = try ActivityEventCoding.makeEncoder().encode(event)
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(object["accessibilityTrusted"] as? Bool == true)
    #expect(object["pointerCaptureAvailable"] as? Bool == true)
}

@Test func URLSanitizerPreservesSearchIntentAndRedactsOtherQueryValues() throws {
    let observation = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://example.com/work?q=computer+history&token=secret&text=private+draft#private",
        title: "Research"
    ))
    #expect(observation.domain == "example.com")
    #expect(observation.url.contains("computer+history"))
    #expect(observation.url.contains("token=%5Bredacted%5D"))
    #expect(!observation.url.contains("secret"))
    #expect(!observation.url.contains("private"))
    let titled = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://example.com/work",
        title: "Draft for person@example.com"
    ))
    #expect(titled.title == "Draft for [redacted email]")
    #expect(!observation.url.contains("draft"))
}

@Test func documentObservationDropsTheHomePrefixAndKeepsUsefulArtifactContext() throws {
    let observation = try #require(SemanticSanitizer.documentObservation(
        rawValue: "file:///Users/example/Documents/OpenHistory/src/main.swift"
    ))
    #expect(observation.name == "main.swift")
    #expect(observation.fileExtension == "swift")
    #expect(observation.displayPath == "OpenHistory/src/main.swift")
    #expect(!observation.displayPath.contains("example"))
    #expect(SemanticSanitizer.documentObservation(rawValue: "https://example.com/file") == nil)

    let event = ActivityEvent(kind: .documentContextChanged, document: observation)
    let data = try ActivityEventCoding.makeEncoder().encode(event)
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(object["kind"] as? String == "document_context_changed")
    #expect((object["document"] as? [String: Any])?["name"] as? String == "main.swift")
}

@Test func URLSanitizerRedactsCredentialShapedPathsAndSearches() throws {
    let credential = "sk-abcdefghijklmnopqrstuvwxyz123456"
    let pathObservation = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://example.com/reset/\(credential)",
        title: nil
    ))
    let searchObservation = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://example.com/search?q=\(credential)",
        title: nil
    ))
    #expect(!pathObservation.url.contains(credential))
    #expect(!searchObservation.url.contains(credential))
    #expect(pathObservation.url.contains("redacted"))
    #expect(searchObservation.url.contains("redacted"))
}

@Test func textChangeFindsInsertedAndDeletedContent() {
    let insertion = SemanticSanitizer.textChange(from: "hello world", to: "hello useful world")
    #expect(insertion.insertedText == "useful ")
    #expect(insertion.deletedCharacterCount == 0)

    let replacement = SemanticSanitizer.textChange(from: "draft message", to: "final message")
    #expect(replacement.insertedText == "final")
    #expect(replacement.deletedCharacterCount == 5)

    let longDocument = String(repeating: "a", count: 10_000)
    let tailInsertion = SemanticSanitizer.textChange(from: longDocument, to: longDocument + " ending")
    #expect(tailInsertion.insertedText == " ending")
    #expect(tailInsertion.resultingValue.hasSuffix(" ending"))
}

@Test func caretMetadataRecoversSmallEditsFromAWindowedDocumentSample() throws {
    let before = String(repeating: "a", count: 1_600)
    let marker = "[middle edit]"
    let insertionOffset = 200
    let expanded = String(before.prefix(insertionOffset)) + marker + String(before.dropFirst(insertionOffset))
    let current = String(expanded.prefix(1_600))
    let change = try #require(SemanticSanitizer.caretTextChange(
        beforeValue: before,
        currentValue: current,
        regionStart: 9_800,
        beforeSelectionLocation: 10_000,
        currentSelectionLocation: 10_000 + marker.count,
        beforeSelectionLength: 0,
        beforeCharacterCount: 20_000,
        currentCharacterCount: 20_000 + marker.count
    ))
    #expect(change.insertedText == marker)
    #expect(change.deletedCharacterCount == 0)

    let deletion = try #require(SemanticSanitizer.caretTextChange(
        beforeValue: before,
        currentValue: before,
        regionStart: 9_800,
        beforeSelectionLocation: 10_000,
        currentSelectionLocation: 9_995,
        beforeSelectionLength: 0,
        beforeCharacterCount: 20_000,
        currentCharacterCount: 19_995
    ))
    #expect(deletion.insertedText.isEmpty)
    #expect(deletion.deletedCharacterCount == 5)
}

@Test func largeDocumentReplacementIsNotClassifiedAsTyping() {
    let original = String(repeating: "a", count: 1_200)
    #expect(SemanticSanitizer.isLikelyDocumentReplacement(from: original, to: "A different note"))
    #expect(!SemanticSanitizer.isLikelyDocumentReplacement(from: "draft", to: "final draft"))
    #expect(SemanticSanitizer.isLikelyDocumentReplacement(
        from: "A short but complete note body",
        to: "A completely different page",
        elementRole: "AXTextArea"
    ))
    #expect(!SemanticSanitizer.isLikelyDocumentReplacement(
        from: "https://example.com/original",
        to: "https://example.com/replacement",
        elementRole: "AXTextField"
    ))
}

@Test func abruptComposerResetPreservesTheCompletedTypingBurst() {
    #expect(SemanticSanitizer.isAbruptTextReset(
        baselineValue: "",
        currentValue: "two complete words",
        nextValue: ""
    ))
    #expect(SemanticSanitizer.isAbruptTextReset(
        baselineValue: "Existing draft",
        currentValue: "Existing draft with a completed sentence",
        nextValue: ""
    ))
    #expect(!SemanticSanitizer.isAbruptTextReset(
        baselineValue: "",
        currentValue: "a",
        nextValue: ""
    ))
    #expect(!SemanticSanitizer.isAbruptTextReset(
        baselineValue: "",
        currentValue: "two complete words",
        nextValue: "two complete word"
    ))
}

@Test func rapidTypingSnapshotsProduceOneCompleteSemanticChange() {
    let snapshots = ["f", "fa", "fast", "fast typing", "fast typing works"]
    let finalChange = SemanticSanitizer.textChange(from: "", to: snapshots.last ?? "")
    #expect(finalChange.insertedText == "fast typing works")
    #expect(finalChange.deletedCharacterCount == 0)
    let duplicate = SemanticSanitizer.textChange(from: snapshots.last ?? "", to: snapshots.last ?? "")
    #expect(duplicate.insertedText.isEmpty)
    #expect(duplicate.deletedCharacterCount == 0)
}

@Test func sensitiveFieldsAndCredentialShapedTextAreRedacted() {
    #expect(SemanticSanitizer.isSensitiveFieldMetadata(["API key", nil]))
    #expect(SemanticSanitizer.isSensitiveFieldMetadata(["Enter your password", "account"]))
    #expect(!SemanticSanitizer.isSensitiveFieldMetadata(["Search notes", "query"]))

    let credential = "sk-abcdefghijklmnopqrstuvwxyz123456"
    let change = SemanticSanitizer.textChange(from: "", to: credential)
    #expect(change.insertedText == "[redacted sensitive value]")
    #expect(change.resultingValue == "[redacted sensitive value]")

    let connectionString = "postgres://user:password@example.com/database"
    #expect(SemanticSanitizer.redactedIfLikelySecret(connectionString) ==
        "postgres://[redacted sensitive value]@example.com/database")
    #expect(SemanticSanitizer.redactedIfLikelySecret("password=hunter2") == "[redacted sensitive value]")
    let jwt = "eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop"
    #expect(SemanticSanitizer.redactedIfLikelySecret(jwt) == "[redacted sensitive value]")

    let mixed = "Deploy with sk-abcdefghijklmnopqrstuvwxyz123456 after review"
    #expect(SemanticSanitizer.redactedIfLikelySecret(mixed) ==
        "Deploy with [redacted sensitive value] after review")
    #expect(SemanticSanitizer.redactedIfLikelySecret("Owner: person@example.com") ==
        "Owner: [redacted email]")
    #expect(SemanticSanitizer.redactedIfLikelySecret(
        "Owner: person@example.com",
        redactEmailAddresses: false
    ) == "Owner: person@example.com")
    #expect(SemanticSanitizer.redactedIfLikelySecret(
        "password=hunter2 for person@example.com",
        redactEmailAddresses: false
    ) == "[redacted sensitive value] for person@example.com")
    #expect(SemanticSanitizer.redactedIfLikelySecret("SSN 123-45-6789") ==
        "SSN [redacted sensitive value]")
    #expect(SemanticSanitizer.redactedIfLikelySecret("Card 4242 4242 4242 4242") ==
        "Card [redacted sensitive value]")
    let callback = SemanticSanitizer.redactedIfLikelySecret(
        "example.com/auth/callback?state=opaque-session-state&code=temporary-code"
    )
    #expect(!callback.contains("opaque-session-state"))
    #expect(!callback.contains("temporary-code"))
    #expect(callback.contains("redacted"))
    #expect(SemanticSanitizer.isSensitiveFieldMetadata(["One-time verification code"]))
    #expect(SemanticSanitizer.isSensitiveTextField(
        role: "AXTextField",
        subrole: "AXSecureTextField",
        metadata: []
    ))
    #expect(SemanticSanitizer.isSensitiveTextField(
        role: "AXTextField",
        subrole: nil,
        metadata: ["current-password", "Sign in"]
    ))
    #expect(!SemanticSanitizer.isSensitiveTextField(
        role: "AXSearchField",
        subrole: nil,
        metadata: ["Search project notes"]
    ))
}

@Test func semanticProtectionPolicyCoversMessagingWithoutBlockingOrdinaryWorkSites() throws {
    #expect(SemanticProtectionPolicy.protectsApplication(bundleIdentifier: "com.apple.MobileSMS"))
    #expect(SemanticProtectionPolicy.protectsApplication(bundleIdentifier: "com.apple.UserNotificationCenter"))
    #expect(SemanticProtectionPolicy.isTransientSystemOverlay(bundleIdentifier: "com.apple.UserNotificationCenter"))
    #expect(!SemanticProtectionPolicy.isTransientSystemOverlay(bundleIdentifier: "com.apple.MobileSMS"))
    #expect(SemanticProtectionPolicy.protectsPrivateBrowsingWindow(title: "New Tab - Incognito"))
    #expect(SemanticProtectionPolicy.protectsPrivateBrowsingWindow(title: "Private Browsing"))
    #expect(SemanticProtectionPolicy.protectsPrivateBrowsingWindow(title: "InPrivate"))
    #expect(!SemanticProtectionPolicy.protectsPrivateBrowsingWindow(title: "Project research"))
    #expect(SemanticProtectionPolicy.protectsApplication(bundleIdentifier: "com.1password.1password"))
    #expect(SemanticProtectionPolicy.protectsApplication(bundleIdentifier: "com.tinyspeck.slackmacgap"))
    #expect(!SemanticProtectionPolicy.protectsApplication(
        bundleIdentifier: "com.apple.MobileSMS",
        captureMessagingActivity: true
    ))
    #expect(!SemanticProtectionPolicy.protectsApplication(
        bundleIdentifier: "com.tinyspeck.slackmacgap",
        captureMessagingActivity: true
    ))
    #expect(SemanticProtectionPolicy.protectsApplication(
        bundleIdentifier: "com.1password.1password",
        captureMessagingActivity: true
    ))
    #expect(SemanticProtectionPolicy.protectsApplication(bundleIdentifier: "com.apple.mail"))
    #expect(!SemanticProtectionPolicy.protectsApplication(
        bundleIdentifier: "com.apple.mail",
        captureEmailActivity: true
    ))
    #expect(!SemanticProtectionPolicy.protectsApplication(bundleIdentifier: "com.apple.Notes"))

    let gmail = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://mail.google.com/mail/u/0/#inbox",
        title: nil
    ))
    let xMessages = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://x.com/messages/123",
        title: nil
    ))
    let linear = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://linear.app/team/issue/ABC-123",
        title: nil
    ))
    let linkedInMessages = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://www.linkedin.com/messaging/thread/123",
        title: nil
    ))
    let unrelatedLookalike = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://notlinkedin.com/messaging/work",
        title: nil
    ))
    let protectedAdultSite = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://www.pornhub.com/view_video.php?viewkey=private",
        title: nil
    ))
    let adultLookalike = try #require(SemanticSanitizer.browserObservation(
        rawURL: "https://notpornhub.com/work",
        title: nil
    ))
    #expect(SemanticProtectionPolicy.protectsBrowserObservation(gmail))
    #expect(!SemanticProtectionPolicy.protectsBrowserObservation(
        gmail,
        captureEmailActivity: true
    ))
    #expect(SemanticProtectionPolicy.protectsBrowserObservation(xMessages))
    #expect(SemanticProtectionPolicy.protectsBrowserObservation(
        xMessages,
        captureEmailActivity: true
    ))
    #expect(!SemanticProtectionPolicy.protectsBrowserObservation(
        xMessages,
        captureMessagingActivity: true
    ))
    #expect(SemanticProtectionPolicy.protectsBrowserObservation(linkedInMessages))
    #expect(!SemanticProtectionPolicy.protectsBrowserObservation(
        linkedInMessages,
        captureMessagingActivity: true
    ))
    #expect(!SemanticProtectionPolicy.protectsBrowserObservation(unrelatedLookalike))
    #expect(SemanticProtectionPolicy.protectsBrowserObservation(protectedAdultSite))
    #expect(SemanticProtectionPolicy.protectsBrowserObservation(
        protectedAdultSite,
        captureMessagingActivity: true
    ))
    #expect(!SemanticProtectionPolicy.protectsBrowserObservation(adultLookalike))
    #expect(!SemanticProtectionPolicy.protectsBrowserObservation(linear))
    #expect(SemanticProtectionPolicy.browserApplications.contains("com.apple.Safari"))
    #expect(SemanticProtectionPolicy.browserApplications.contains("org.mozilla.firefox"))
    #expect(!SemanticProtectionPolicy.browserApplications.contains("notion.id"))
}

@Test func semanticEventEncodingRemainsBackwardCompatibleVersionOne() throws {
    let event = ActivityEvent(
        kind: .textInput,
        application: ApplicationDescriptor(
            bundleIdentifier: "com.apple.Notes",
            localizedName: "Notes",
            processIdentifier: 99
        ),
        element: SemanticElement(role: "AXTextArea", label: "Note body"),
        selectedElements: [SemanticElement(role: "AXRow", label: "Project note")],
        textChange: TextChange(
            insertedText: "prototype observation",
            deletedCharacterCount: 0,
            resultingValue: "prototype observation"
        )
    )
    let data = try ActivityEventCoding.makeEncoder().encode(event)
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(object["version"] as? Int == 1)
    #expect(object["kind"] as? String == "text_input")
    #expect((object["textChange"] as? [String: Any])?["insertedText"] as? String == "prototype observation")
    #expect(((object["selectedElements"] as? [[String: Any]])?.first)?["label"] as? String == "Project note")
}
