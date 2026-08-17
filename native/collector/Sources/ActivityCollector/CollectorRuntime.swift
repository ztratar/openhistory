import ActivityCore
import AppKit
@preconcurrency import ApplicationServices
import Foundation

struct CaptureConfiguration {
    let windowTitles: Bool
    let focusedElements: Bool
    let textInput: Bool
    let pointerClicks: Bool
    let browserURLs: Bool
    let documentContext: Bool
    let uiSnapshots: Bool
    let emailActivity: Bool
    let messagingActivity: Bool
    let excludedBundleIdentifiers: Set<String>
    let excludedProcessIdentifiers: Set<pid_t>
    let promptAccessibility: Bool
    let emitHeartbeat: Bool

    init(environment: [String: String]) {
        windowTitles = environment["OPENHISTORY_CAPTURE_WINDOW_TITLES"] != "false"
        focusedElements = environment["OPENHISTORY_CAPTURE_FOCUSED_ELEMENTS"] != "false"
        textInput = environment["OPENHISTORY_CAPTURE_TEXT_INPUT"] != "false"
        pointerClicks = environment["OPENHISTORY_CAPTURE_POINTER_CLICKS"] != "false"
        browserURLs = environment["OPENHISTORY_CAPTURE_BROWSER_URLS"] != "false"
        documentContext = environment["OPENHISTORY_CAPTURE_DOCUMENT_CONTEXT"] != "false"
        uiSnapshots = environment["OPENHISTORY_CAPTURE_UI_SNAPSHOTS"] != "false"
        emailActivity = environment["OPENHISTORY_CAPTURE_EMAIL_ACTIVITY"] == "true"
        messagingActivity = environment["OPENHISTORY_CAPTURE_MESSAGING_ACTIVITY"] == "true"
        excludedBundleIdentifiers = Set(
            (environment["OPENHISTORY_EXCLUDED_BUNDLE_IDENTIFIERS"] ?? "")
                .split(separator: ",").map(String.init)
        )
        excludedProcessIdentifiers = Set(
            (environment["OPENHISTORY_EXCLUDED_PROCESS_IDENTIFIERS"] ?? "")
                .split(separator: ",").compactMap { pid_t($0) }
        )
        promptAccessibility = environment["OPENHISTORY_PROMPT_ACCESSIBILITY"] == "true"
        emitHeartbeat = true
    }

    init(
        windowTitles: Bool,
        focusedElements: Bool,
        textInput: Bool,
        pointerClicks: Bool,
        browserURLs: Bool,
        documentContext: Bool,
        uiSnapshots: Bool,
        emailActivity: Bool,
        messagingActivity: Bool,
        excludedBundleIdentifiers: Set<String>,
        excludedProcessIdentifiers: Set<pid_t>,
        promptAccessibility: Bool = false,
        emitHeartbeat: Bool = false
    ) {
        self.windowTitles = windowTitles
        self.focusedElements = focusedElements
        self.textInput = textInput
        self.pointerClicks = pointerClicks
        self.browserURLs = browserURLs
        self.documentContext = documentContext
        self.uiSnapshots = uiSnapshots
        self.emailActivity = emailActivity
        self.messagingActivity = messagingActivity
        self.excludedBundleIdentifiers = excludedBundleIdentifiers
        self.excludedProcessIdentifiers = excludedProcessIdentifiers
        self.promptAccessibility = promptAccessibility
        self.emitHeartbeat = emitHeartbeat
    }
}

private struct PendingTextEdit {
    let key: String
    let before: FocusedTextObservation
    var current: FocusedTextObservation
    let element: SemanticElement
    let application: ApplicationDescriptor
    let windowTitle: String?
    var lastChangedAt: Date
}

private struct BrowserContext {
    let observation: BrowserObservation?
    let isProtected: Bool
}

final class ApplicationActivityCollector: @unchecked Sendable {
    private let writer: EventWriter
    private let workspace = NSWorkspace.shared
    private let accessibility: AccessibilityReader
    private let configuration: CaptureConfiguration
    private var observers: [NSObjectProtocol] = []
    private var semanticSampler: Timer?
    private var heartbeatTimer: Timer?
    private var pointerEventTap: PointerEventTap?
    private var lastObservableApplication: NSRunningApplication?
    private var sessionActive = true
    private var screenAwake = true
    private var lastWindowKey: String?
    private var lastActivationKey: String?
    private var lastActivationAt = Date.distantPast
    private var lastFocusedKey: String?
    private var lastSelectionKey: [String: String] = [:]
    private var selectionMissCount: [String: Int] = [:]
    private var lastObservedText: [String: FocusedTextObservation] = [:]
    private var pendingTextEdit: PendingTextEdit?
    private var lastBrowserObservation: [String: BrowserObservation] = [:]
    private var lastDocumentObservation: [String: DocumentObservation] = [:]
    private var lastBrowserSampleAt: [String: Date] = [:]
    private var protectedBrowserProcessIdentifier: pid_t?
    private var lastSnapshotKey: [String: String] = [:]
    private var lastSnapshotAt: [String: Date] = [:]

    private let browserApplications = SemanticProtectionPolicy.browserApplications.union([
        "com.figma.Desktop",
        "com.linear",
        "notion.id"
    ])
    init(
        writer: EventWriter,
        configuration: CaptureConfiguration = CaptureConfiguration(
            environment: ProcessInfo.processInfo.environment
        )
    ) {
        self.writer = writer
        self.configuration = configuration
        self.accessibility = AccessibilityReader(
            redactEmailAddresses: !configuration.emailActivity
        )
    }

    func start() {
        if configuration.promptAccessibility {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }
        let trusted = AXIsProcessTrusted()
        if trusted && configuration.pointerClicks {
            pointerEventTap = PointerEventTap { [weak self] point in
                DispatchQueue.main.async { self?.recordPointerClick(at: point) }
            }
            if pointerEventTap == nil {
                FileHandle.standardError.write(Data("pointer event tap unavailable\n".utf8))
            }
        }
        emit(ActivityEvent(
            kind: .collectorStarted,
            accessibilityTrusted: trusted,
            pointerCaptureAvailable: configuration.pointerClicks ? pointerEventTap != nil : nil
        ))
        if configuration.emitHeartbeat {
            heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
                FileHandle.standardOutput.write(Data("__OPENHISTORY_HEARTBEAT__\n".utf8))
            }
        }

        if let application = workspace.frontmostApplication {
            record(application, kind: .applicationActivated)
        }
        registerWorkspaceObservers()

        if trusted && semanticCaptureEnabled {
            semanticSampler = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
                self?.sampleSemanticActivity()
            }
            sampleSemanticActivity()
        }
    }

    func stop() {
        flushPendingTextEdit()
        semanticSampler?.invalidate()
        semanticSampler = nil
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        pointerEventTap = nil
        let center = workspace.notificationCenter
        for observer in observers { center.removeObserver(observer) }
        observers.removeAll()
    }

    private var semanticCaptureEnabled: Bool {
        configuration.windowTitles || configuration.focusedElements || configuration.textInput ||
            configuration.browserURLs || configuration.documentContext || configuration.uiSnapshots
    }

    private func registerWorkspaceObservers() {
        let center = workspace.notificationCenter
        observers.append(center.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.flushPendingTextEdit()
            self?.lastFocusedKey = nil
            self?.leaveProtectedBrowserContext()
            self?.record(application, kind: .applicationActivated)
            self?.sampleSemanticActivity()
        })

        observers.append(center.addObserver(
            forName: NSWorkspace.didTerminateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            guard self?.lastObservableApplication?.processIdentifier == application.processIdentifier else { return }
            self?.record(application, kind: .applicationTerminated)
            self?.lastObservableApplication = nil
        })

        observers.append(center.addObserver(
            forName: NSWorkspace.screensDidSleepNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.flushPendingTextEdit()
            self?.screenAwake = false
            self?.emit(ActivityEvent(kind: .screenSlept))
        })

        observers.append(center.addObserver(
            forName: NSWorkspace.screensDidWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.screenAwake = true
            self?.emit(ActivityEvent(kind: .screenWoke))
            self?.sampleSemanticActivity()
        })

        observers.append(center.addObserver(
            forName: NSWorkspace.sessionDidResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.flushPendingTextEdit()
            self?.sessionActive = false
            self?.emit(ActivityEvent(kind: .sessionLocked))
        })

        observers.append(center.addObserver(
            forName: NSWorkspace.sessionDidBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.sessionActive = true
            self?.emit(ActivityEvent(kind: .sessionUnlocked))
            self?.sampleSemanticActivity()
        })
    }

    private func record(_ application: NSRunningApplication, kind: ActivityEvent.Kind) {
        guard shouldObserve(application) else { return }
        if kind == .applicationActivated { lastObservableApplication = application }
        let descriptor = applicationDescriptor(application)
        let privacyWindowTitle = accessibility.focusedWindowTitle(
            processIdentifier: application.processIdentifier
        )
        let protectedContext = kind == .applicationActivated && browserContext(
            for: application,
            rawURL: accessibility.browserAddress(processIdentifier: application.processIdentifier),
            windowTitle: privacyWindowTitle
        ).isProtected
        let title = configuration.windowTitles && kind == .applicationActivated && !protectedContext
            ? privacyWindowTitle
            : nil
        if kind == .applicationActivated {
            let key = observationKey(application: descriptor, windowTitle: title)
            if key == lastActivationKey, Date().timeIntervalSince(lastActivationAt) < 2 { return }
            lastActivationKey = key
            lastActivationAt = Date()
            lastWindowKey = key
        }
        emit(ActivityEvent(kind: kind, application: descriptor, windowTitle: title))
    }

    private func sampleSemanticActivity() {
        guard sessionActive, screenAwake, AXIsProcessTrusted(),
              let application = applicationForSemanticSampling(),
              shouldObserve(application) else {
            discardPendingTextEdit()
            return
        }
        let descriptor = applicationDescriptor(application)
        let processIdentifier = application.processIdentifier
        let focusedWindow = accessibility.focusedWindow(processIdentifier: processIdentifier)
        let rawBrowserURL = focusedWindow.flatMap { accessibility.browserAddress(root: $0) }
        let privacyWindowTitle = focusedWindow.flatMap { accessibility.focusedWindowTitle(window: $0) }
        let browserContext = browserContext(
            for: application,
            rawURL: rawBrowserURL,
            windowTitle: privacyWindowTitle
        )
        if browserContext.isProtected {
            discardPendingTextEdit()
            return
        }
        let windowTitle = configuration.windowTitles
            ? privacyWindowTitle
            : nil

        if configuration.windowTitles {
            let key = observationKey(application: descriptor, windowTitle: windowTitle)
            if key != lastWindowKey {
                lastWindowKey = key
                emit(ActivityEvent(kind: .windowChanged, application: descriptor, windowTitle: windowTitle))
            }
        }

        emitBrowserObservation(
            browserContext.observation,
            application: application,
            descriptor: descriptor,
            windowTitle: windowTitle
        )
        sampleDocumentContext(
            application: application,
            descriptor: descriptor,
            windowTitle: windowTitle,
            focusedWindow: focusedWindow
        )

        let focusedElement = (configuration.focusedElements || configuration.textInput)
            ? accessibility.focusedElement(processIdentifier: processIdentifier)
            : nil
        let sensitiveFocusedText = focusedElement.map {
            accessibility.isSensitiveTextInput(element: $0)
        } ?? false

        if sensitiveFocusedText {
            discardPendingTextEdit()
            clearTextState(processIdentifier: processIdentifier)
        }

        if configuration.focusedElements, !sensitiveFocusedText, let focusedElement {
            let focused = accessibility.semanticFocusedElement(
                element: focusedElement,
                processIdentifier: processIdentifier
            )
            if focused.key != lastFocusedKey {
                flushPendingTextEdit()
                lastFocusedKey = focused.key
                emit(ActivityEvent(
                    kind: .focusedElementChanged,
                    application: descriptor,
                    windowTitle: windowTitle,
                    element: focused.element
                ))
            }
        }

        if configuration.focusedElements, !sensitiveFocusedText {
            let selectionKey = descriptor.bundleIdentifier ?? String(descriptor.processIdentifier)
            if let focusedElement,
               let selection = accessibility.semanticSelection(
                   element: focusedElement,
                   processIdentifier: processIdentifier
               ) {
                selectionMissCount[selectionKey] = 0
                if selection.key != lastSelectionKey[selectionKey] {
                    lastSelectionKey[selectionKey] = selection.key
                    emit(ActivityEvent(
                        kind: .selectionChanged,
                        application: descriptor,
                        windowTitle: windowTitle,
                        selectedElements: selection.elements
                    ))
                }
            } else {
                let misses = (selectionMissCount[selectionKey] ?? 0) + 1
                selectionMissCount[selectionKey] = misses
                if misses >= 3 {
                    lastSelectionKey.removeValue(forKey: selectionKey)
                    selectionMissCount.removeValue(forKey: selectionKey)
                }
            }
        }

        if configuration.textInput, !sensitiveFocusedText {
            sampleTextInput(
                focusedElement: focusedElement,
                processIdentifier: processIdentifier,
                application: descriptor,
                windowTitle: windowTitle
            )
        }
        let snapshotContextKey = observationKey(application: descriptor, windowTitle: windowTitle)
        if configuration.uiSnapshots, !sensitiveFocusedText,
           Date().timeIntervalSince(lastSnapshotAt[snapshotContextKey] ?? .distantPast) >= 10 {
            boundSnapshotCaches(retaining: snapshotContextKey)
            lastSnapshotAt[snapshotContextKey] = Date()
            let visibleText = focusedWindow.map { accessibility.visibleText(root: $0) } ?? []
            let key = visibleText.joined(separator: "\u{1F}")
            if !visibleText.isEmpty, key != lastSnapshotKey[snapshotContextKey] {
                lastSnapshotKey[snapshotContextKey] = key
                emit(ActivityEvent(
                    kind: .uiSnapshot,
                    application: descriptor,
                    windowTitle: windowTitle,
                    visibleText: visibleText
                ))
            }
        }
    }

    private func browserContext(
        for application: NSRunningApplication,
        rawURL: String?,
        windowTitle: String?
    ) -> BrowserContext {
        guard let bundleIdentifier = application.bundleIdentifier,
              browserApplications.contains(bundleIdentifier) else {
            return BrowserContext(observation: nil, isProtected: false)
        }
        if SemanticProtectionPolicy.protectsPrivateBrowsingWindow(title: windowTitle) {
            enterProtectedBrowserContext(processIdentifier: application.processIdentifier)
            return BrowserContext(observation: nil, isProtected: true)
        }
        guard let rawURL,
              let observation = SemanticSanitizer.browserObservation(
                  rawURL: rawURL,
                  title: nil,
                  redactEmailAddresses: !configuration.emailActivity
              ) else {
            let protected = SemanticProtectionPolicy.browserApplications.contains(bundleIdentifier) ||
                protectedBrowserProcessIdentifier == application.processIdentifier
            if protected { enterProtectedBrowserContext(processIdentifier: application.processIdentifier) }
            return BrowserContext(observation: nil, isProtected: protected)
        }
        let protected = SemanticProtectionPolicy.protectsBrowserObservation(
            observation,
            captureEmailActivity: configuration.emailActivity,
            captureMessagingActivity: configuration.messagingActivity
        )
        if protected {
            enterProtectedBrowserContext(processIdentifier: application.processIdentifier)
        } else if protectedBrowserProcessIdentifier == application.processIdentifier {
            leaveProtectedBrowserContext()
        }
        return BrowserContext(observation: observation, isProtected: protected)
    }

    private func enterProtectedBrowserContext(processIdentifier: pid_t) {
        guard protectedBrowserProcessIdentifier != processIdentifier else { return }
        if protectedBrowserProcessIdentifier != nil { leaveProtectedBrowserContext() }
        protectedBrowserProcessIdentifier = processIdentifier
        clearTextState(processIdentifier: processIdentifier)
        emit(ActivityEvent(kind: .privacyBoundary))
    }

    private func leaveProtectedBrowserContext() {
        guard let processIdentifier = protectedBrowserProcessIdentifier else { return }
        protectedBrowserProcessIdentifier = nil
        clearTextState(processIdentifier: processIdentifier)
        emit(ActivityEvent(kind: .privacyBoundary))
    }

    private func clearTextState(processIdentifier: pid_t) {
        discardPendingTextEdit()
        lastFocusedKey = nil
        let prefix = "\(processIdentifier):"
        lastObservedText = lastObservedText.filter { !$0.key.hasPrefix(prefix) }
        lastSelectionKey.removeAll(keepingCapacity: true)
        selectionMissCount.removeAll(keepingCapacity: true)
    }

    private func emitBrowserObservation(
        _ observation: BrowserObservation?,
        application: NSRunningApplication,
        descriptor: ApplicationDescriptor,
        windowTitle: String?
    ) {
        guard configuration.browserURLs,
              let observation,
              let bundleIdentifier = application.bundleIdentifier,
              Date().timeIntervalSince(lastBrowserSampleAt[bundleIdentifier] ?? .distantPast) >= 2 else { return }
        lastBrowserSampleAt[bundleIdentifier] = Date()
        let titledObservation = BrowserObservation(
            url: observation.url,
            domain: observation.domain,
            title: windowTitle
        )
        guard titledObservation != lastBrowserObservation[bundleIdentifier] else { return }
        lastBrowserObservation[bundleIdentifier] = titledObservation
        emit(ActivityEvent(
            kind: .urlChanged,
            application: descriptor,
            windowTitle: windowTitle,
            browser: titledObservation
        ))
    }

    private func sampleDocumentContext(
        application: NSRunningApplication,
        descriptor: ApplicationDescriptor,
        windowTitle: String?,
        focusedWindow: AXUIElement?
    ) {
        guard configuration.documentContext,
              let bundleIdentifier = application.bundleIdentifier else { return }
        let observation = accessibility.focusedDocument(
            processIdentifier: application.processIdentifier,
            window: focusedWindow
        ) ?? finderFolderObservation(bundleIdentifier: bundleIdentifier, windowTitle: windowTitle)
        guard let observation,
              observation != lastDocumentObservation[bundleIdentifier] else { return }
        lastDocumentObservation[bundleIdentifier] = observation
        emit(ActivityEvent(
            kind: .documentContextChanged,
            application: descriptor,
            windowTitle: windowTitle,
            document: observation
        ))
    }

    private func finderFolderObservation(
        bundleIdentifier: String,
        windowTitle: String?
    ) -> DocumentObservation? {
        guard bundleIdentifier == "com.apple.finder",
              let windowTitle,
              !windowTitle.isEmpty else { return nil }
        return DocumentObservation(displayPath: windowTitle, name: windowTitle, fileExtension: nil)
    }

    private func sampleTextInput(
        focusedElement: AXUIElement?,
        processIdentifier: pid_t,
        application: ApplicationDescriptor,
        windowTitle: String?
    ) {
        guard let focusedElement,
              let observation = accessibility.focusedTextObservation(
                  element: focusedElement,
                  processIdentifier: processIdentifier
              ),
              !observation.isSecure else {
            flushPendingTextEdit()
            return
        }

        if lastObservedText[observation.key] == nil, lastObservedText.count >= 512 {
            let retained = pendingTextEdit.map { ($0.key, $0.current) }
            lastObservedText.removeAll(keepingCapacity: true)
            if let retained { lastObservedText[retained.0] = retained.1 }
        }

        guard let previous = lastObservedText[observation.key] else {
            lastObservedText[observation.key] = observation
            return
        }
        if previous.value != observation.value {
            if pendingTextEdit?.key == observation.key {
                pendingTextEdit?.current = observation
                pendingTextEdit?.lastChangedAt = Date()
            } else {
                flushPendingTextEdit()
                pendingTextEdit = PendingTextEdit(
                    key: observation.key,
                    before: previous,
                    current: observation,
                    element: observation.element,
                    application: application,
                    windowTitle: windowTitle,
                    lastChangedAt: Date()
                )
            }
            lastObservedText[observation.key] = observation
        } else if let pendingTextEdit,
                  pendingTextEdit.key == observation.key,
                  Date().timeIntervalSince(pendingTextEdit.lastChangedAt) >= 1.2 {
            flushPendingTextEdit()
        }
    }

    private func flushPendingTextEdit() {
        guard let edit = pendingTextEdit else { return }
        pendingTextEdit = nil
        let preciseCaretChange = caretTextChange(edit)
        let change = preciseCaretChange ?? SemanticSanitizer.textChange(
            from: edit.before.value,
            to: edit.current.value,
            redactEmailAddresses: !configuration.emailActivity
        )
        guard !change.insertedText.isEmpty || change.deletedCharacterCount > 0 else { return }
        emit(ActivityEvent(
            kind: preciseCaretChange == nil && SemanticSanitizer.isLikelyDocumentReplacement(
                from: edit.before.value,
                to: edit.current.value,
                elementRole: edit.element.role,
                redactEmailAddresses: !configuration.emailActivity
            )
                ? .documentChanged
                : .textInput,
            application: edit.application,
            windowTitle: edit.windowTitle,
            element: edit.element,
            textChange: change
        ))
    }

    private func discardPendingTextEdit() {
        pendingTextEdit = nil
    }

    private func caretTextChange(_ edit: PendingTextEdit) -> TextChange? {
        let before = edit.before
        let current = edit.current
        guard let regionStart = before.regionStart,
              current.regionStart == regionStart,
              let beforeLocation = before.selectionLocation,
              let currentLocation = current.selectionLocation,
              let beforeSelectionLength = before.selectionLength,
              let beforeCharacterCount = before.characterCount,
              let currentCharacterCount = current.characterCount,
              !before.value.contains("[redacted"),
              !current.value.contains("[redacted") else { return nil }

        return SemanticSanitizer.caretTextChange(
            beforeValue: before.value,
            currentValue: current.value,
            regionStart: regionStart,
            beforeSelectionLocation: beforeLocation,
            currentSelectionLocation: currentLocation,
            beforeSelectionLength: beforeSelectionLength,
            beforeCharacterCount: beforeCharacterCount,
            currentCharacterCount: currentCharacterCount,
            redactEmailAddresses: !configuration.emailActivity
        )
    }

    private func recordPointerClick(at point: CGPoint) {
        guard sessionActive, screenAwake,
              let application = workspace.frontmostApplication,
              shouldObserve(application),
              !browserContext(
                  for: application,
                  rawURL: accessibility.browserAddress(processIdentifier: application.processIdentifier),
                  windowTitle: accessibility.focusedWindowTitle(
                      processIdentifier: application.processIdentifier
                  )
              ).isProtected else { return }
        let descriptor = applicationDescriptor(application)
        emit(ActivityEvent(
            kind: .pointerClick,
            application: descriptor,
            windowTitle: configuration.windowTitles
                ? accessibility.focusedWindowTitle(processIdentifier: application.processIdentifier)
                : nil,
            element: accessibility.semanticElement(at: point)
        ))
        // Mouse-down can precede the target becoming the focused accessibility element. A short
        // follow-up sample establishes the field baseline before ordinary typing gets underway.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
            self?.sampleSemanticActivity()
        }
    }

    private func shouldObserve(_ application: NSRunningApplication) -> Bool {
        guard !configuration.excludedProcessIdentifiers.contains(application.processIdentifier) else { return false }
        guard let bundleIdentifier = application.bundleIdentifier else { return true }
        return !configuration.excludedBundleIdentifiers.contains(bundleIdentifier) &&
            !SemanticProtectionPolicy.protectsApplication(
                bundleIdentifier: bundleIdentifier,
                captureEmailActivity: configuration.emailActivity,
                captureMessagingActivity: configuration.messagingActivity
            )
    }

    private func applicationForSemanticSampling() -> NSRunningApplication? {
        guard let frontmost = workspace.frontmostApplication else { return nil }
        if let bundleIdentifier = frontmost.bundleIdentifier,
           SemanticProtectionPolicy.isTransientSystemOverlay(bundleIdentifier: bundleIdentifier) {
            guard let lastObservableApplication, !lastObservableApplication.isTerminated else { return nil }
            return lastObservableApplication
        }
        if shouldObserve(frontmost) { lastObservableApplication = frontmost }
        return frontmost
    }

    private func applicationDescriptor(_ application: NSRunningApplication) -> ApplicationDescriptor {
        ApplicationDescriptor(
            bundleIdentifier: application.bundleIdentifier,
            localizedName: application.localizedName,
            processIdentifier: application.processIdentifier
        )
    }

    private func observationKey(application: ApplicationDescriptor, windowTitle: String?) -> String {
        "\(application.bundleIdentifier ?? String(application.processIdentifier))\u{1F}\(windowTitle ?? "")"
    }

    private func boundSnapshotCaches(retaining key: String) {
        guard lastSnapshotAt[key] == nil, lastSnapshotAt.count >= 128 else { return }
        lastSnapshotAt.removeAll(keepingCapacity: true)
        lastSnapshotKey.removeAll(keepingCapacity: true)
    }

    private func emit(_ event: ActivityEvent) {
        do {
            try writer.write(event)
        } catch {
            FileHandle.standardError.write(Data("collector write failed: \(error)\n".utf8))
        }
    }
}
