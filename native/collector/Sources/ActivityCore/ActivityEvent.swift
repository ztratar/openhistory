import Foundation

public struct ApplicationDescriptor: Codable, Equatable, Sendable {
    public let bundleIdentifier: String?
    public let localizedName: String?
    public let processIdentifier: Int32

    public init(bundleIdentifier: String?, localizedName: String?, processIdentifier: Int32) {
        self.bundleIdentifier = bundleIdentifier
        self.localizedName = localizedName
        self.processIdentifier = processIdentifier
    }
}

public struct ActivityEvent: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case collectorStarted = "collector_started"
        case applicationActivated = "application_activated"
        case windowChanged = "window_changed"
        case focusedElementChanged = "focused_element_changed"
        case selectionChanged = "selection_changed"
        case textInput = "text_input"
        case documentChanged = "document_changed"
        case pointerClick = "pointer_click"
        case urlChanged = "url_changed"
        case documentContextChanged = "document_context_changed"
        case uiSnapshot = "ui_snapshot"
        case applicationTerminated = "application_terminated"
        case screenSlept = "screen_slept"
        case screenWoke = "screen_woke"
        case sessionLocked = "session_locked"
        case sessionUnlocked = "session_unlocked"
        case privacyBoundary = "privacy_boundary"
    }

    public let version: Int
    public let id: UUID
    public let timestamp: Date
    public let kind: Kind
    public let application: ApplicationDescriptor?
    public let windowTitle: String?
    public let accessibilityTrusted: Bool?
    public let pointerCaptureAvailable: Bool?
    public let element: SemanticElement?
    public let selectedElements: [SemanticElement]?
    public let textChange: TextChange?
    public let browser: BrowserObservation?
    public let document: DocumentObservation?
    public let visibleText: [String]?

    public init(
        id: UUID = UUID(),
        timestamp: Date = Date(),
        kind: Kind,
        application: ApplicationDescriptor? = nil,
        windowTitle: String? = nil,
        accessibilityTrusted: Bool? = nil,
        pointerCaptureAvailable: Bool? = nil,
        element: SemanticElement? = nil,
        selectedElements: [SemanticElement]? = nil,
        textChange: TextChange? = nil,
        browser: BrowserObservation? = nil,
        document: DocumentObservation? = nil,
        visibleText: [String]? = nil
    ) {
        self.version = 1
        self.id = id
        self.timestamp = timestamp
        self.kind = kind
        self.application = application
        self.windowTitle = windowTitle
        self.accessibilityTrusted = accessibilityTrusted
        self.pointerCaptureAvailable = pointerCaptureAvailable
        self.element = element
        self.selectedElements = selectedElements
        self.textChange = textChange
        self.browser = browser
        self.document = document
        self.visibleText = visibleText
    }
}

public enum ActivityEventCoding {
    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}
