import ActivityCore
import ApplicationServices
import Foundation

struct FocusedTextObservation {
    let key: String
    let element: SemanticElement
    let value: String
    let isSecure: Bool
    let regionStart: Int?
    let selectionLocation: Int?
    let selectionLength: Int?
    let characterCount: Int?
}

final class AccessibilityReader: @unchecked Sendable {
    private var enhancedProcessIdentifiers = Set<pid_t>()
    private var discoveredFocusedElements: [pid_t: AXUIElement] = [:]
    private var focusedDiscoveryInFlight = Set<pid_t>()
    private var lastFocusedDiscoveryAt: [pid_t: Date] = [:]
    private let focusedDiscoveryLock = NSLock()
    private let focusedDiscoveryQueue = DispatchQueue(
        label: "io.github.ztratar.openhistory.accessibility-focus-discovery",
        qos: .utility
    )
    private let redactEmailAddresses: Bool

    init(redactEmailAddresses: Bool = true) {
        self.redactEmailAddresses = redactEmailAddresses
    }

    func focusedWindow(processIdentifier: pid_t) -> AXUIElement? {
        prepareApplication(processIdentifier: processIdentifier)
        return elementAttribute(
            AXUIElementCreateApplication(processIdentifier),
            attribute: kAXFocusedWindowAttribute as CFString
        )
    }

    func focusedWindowTitle(processIdentifier: pid_t) -> String? {
        guard let window = focusedWindow(processIdentifier: processIdentifier) else { return nil }
        return focusedWindowTitle(window: window)
    }

    func focusedWindowTitle(window: AXUIElement) -> String? {
        return stringAttribute(window, attribute: kAXTitleAttribute as CFString).map {
            SemanticSanitizer.clipped(
                redactedIfLikelySecret(normalize($0)),
                limit: 500
            )
        }
    }

    func focusedDocument(
        processIdentifier: pid_t,
        window providedWindow: AXUIElement? = nil
    ) -> DocumentObservation? {
        let application = AXUIElementCreateApplication(processIdentifier)
        let window = providedWindow ?? focusedWindow(processIdentifier: processIdentifier)
        let candidates = [
            window.flatMap { stringAttribute($0, attribute: kAXDocumentAttribute as CFString) },
            window.flatMap { stringAttribute($0, attribute: kAXURLAttribute as CFString) },
            stringAttribute(application, attribute: kAXDocumentAttribute as CFString),
            stringAttribute(application, attribute: kAXURLAttribute as CFString)
        ]
        for rawValue in candidates.compactMap({ $0 }) {
            if let observation = SemanticSanitizer.documentObservation(
                rawValue: rawValue,
                redactEmailAddresses: redactEmailAddresses
            ) {
                return observation
            }
        }
        return nil
    }

    func focusedElement(processIdentifier: pid_t) -> AXUIElement? {
        prepareApplication(processIdentifier: processIdentifier)
        let application = AXUIElementCreateApplication(processIdentifier)
        if let focused = elementAttribute(
            application,
            attribute: kAXFocusedUIElementAttribute as CFString
        ) {
            return focused
        }
        if let focused = elementAttribute(
            AXUIElementCreateSystemWide(),
            attribute: kAXFocusedUIElementAttribute as CFString
        ), belongsToProcess(focused, processIdentifier: processIdentifier) {
            return focused
        }
        focusedDiscoveryLock.lock()
        let cached = discoveredFocusedElements[processIdentifier]
        focusedDiscoveryLock.unlock()
        if let cached,
           booleanAttribute(cached, attribute: kAXFocusedAttribute as CFString) == true,
           belongsToProcess(cached, processIdentifier: processIdentifier) {
            return cached
        }
        focusedDiscoveryLock.lock()
        discoveredFocusedElements.removeValue(forKey: processIdentifier)
        focusedDiscoveryLock.unlock()
        return nil
    }

    func discoverFocusedElementIfNeeded(processIdentifier: pid_t) {
        focusedDiscoveryLock.lock()
        let recentlyAttempted = Date().timeIntervalSince(
            lastFocusedDiscoveryAt[processIdentifier] ?? .distantPast
        ) < 3
        guard !focusedDiscoveryInFlight.contains(processIdentifier), !recentlyAttempted else {
            focusedDiscoveryLock.unlock()
            return
        }
        focusedDiscoveryInFlight.insert(processIdentifier)
        lastFocusedDiscoveryAt[processIdentifier] = Date()
        focusedDiscoveryLock.unlock()

        focusedDiscoveryQueue.async { [weak self] in
            guard let self else { return }
            let application = AXUIElementCreateApplication(processIdentifier)
            let discovered = self.focusedEditableDescendant(
                application: application,
                processIdentifier: processIdentifier
            )
            self.focusedDiscoveryLock.lock()
            if let discovered {
                self.discoveredFocusedElements[processIdentifier] = discovered
            }
            self.focusedDiscoveryInFlight.remove(processIdentifier)
            self.focusedDiscoveryLock.unlock()
        }
    }

    func focusedTextObservation(processIdentifier: pid_t) -> FocusedTextObservation? {
        guard let element = focusedElement(processIdentifier: processIdentifier) else { return nil }
        return focusedTextObservation(element: element, processIdentifier: processIdentifier)
    }

    func focusedTextObservation(
        element: AXUIElement,
        processIdentifier: pid_t
    ) -> FocusedTextObservation? {
        let role = stringAttribute(element, attribute: kAXRoleAttribute as CFString)
        let subrole = stringAttribute(element, attribute: kAXSubroleAttribute as CFString)
        let editableRoles = Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"])
        let editableContainerRoles = Set(["AXGroup", "AXWebArea", "AXUnknown"])
        let isEditableContainer = role.map(editableContainerRoles.contains) == true &&
            isAttributeSettable(element, attribute: kAXValueAttribute as CFString)
        guard role.map(editableRoles.contains) == true || subrole == "AXSearchField" || isEditableContainer else {
            return nil
        }
        let secure = isSensitive(element, role: role, subrole: subrole)
        guard !secure else { return nil }
        let documentLikeRoles = Set(["AXTextArea", "AXGroup", "AXWebArea", "AXUnknown"])
        let localSample = role.map(documentLikeRoles.contains) == true
            ? selectedTextSample(element)
            : nil
        guard let value = localSample?.value ?? stringAttribute(
            element,
            attribute: kAXValueAttribute as CFString
        ) else { return nil }
        return FocusedTextObservation(
            key: "\(processIdentifier):\(CFHash(element)):\(localSample?.regionKey ?? "value")",
            element: semanticElement(element, includeValue: false),
            value: SemanticSanitizer.boundedTextValue(
                redactedIfLikelySecret(value),
                limit: 8_000
            ),
            isSecure: false,
            regionStart: localSample?.regionStart,
            selectionLocation: localSample?.selectionLocation,
            selectionLength: localSample?.selectionLength,
            characterCount: localSample?.characterCount
        )
    }

    func isSensitiveTextInput(element: AXUIElement) -> Bool {
        let role = stringAttribute(element, attribute: kAXRoleAttribute as CFString)
        let subrole = stringAttribute(element, attribute: kAXSubroleAttribute as CFString)
        let editableRoles = Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"])
        let editableContainerRoles = Set(["AXGroup", "AXWebArea", "AXUnknown"])
        let isEditable = role.map(editableRoles.contains) == true ||
            subrole == "AXSearchField" ||
            (role.map(editableContainerRoles.contains) == true &&
                isAttributeSettable(element, attribute: kAXValueAttribute as CFString))
        let hasSecureRole = role?.localizedCaseInsensitiveContains("secure") == true ||
            subrole?.localizedCaseInsensitiveContains("secure") == true
        guard isEditable || hasSecureRole else { return false }
        return isSensitive(element, role: role, subrole: subrole)
    }

    func semanticFocusedElement(processIdentifier: pid_t) -> (key: String, element: SemanticElement)? {
        guard let element = focusedElement(processIdentifier: processIdentifier) else { return nil }
        return semanticFocusedElement(element: element, processIdentifier: processIdentifier)
    }

    func semanticFocusedElement(
        element: AXUIElement,
        processIdentifier: pid_t
    ) -> (key: String, element: SemanticElement) {
        return ("\(processIdentifier):\(CFHash(element))", semanticElement(element, includeValue: false))
    }

    func semanticSelection(processIdentifier: pid_t) -> (key: String, elements: [SemanticElement])? {
        guard let element = focusedElement(processIdentifier: processIdentifier) else { return nil }
        return semanticSelection(element: element, processIdentifier: processIdentifier)
    }

    func semanticSelection(
        element: AXUIElement,
        processIdentifier: pid_t
    ) -> (key: String, elements: [SemanticElement])? {
        var current = element
        for _ in 0..<5 {
            var selected = elementsAttribute(current, attribute: kAXSelectedRowsAttribute as CFString)
            selected.append(contentsOf: elementsAttribute(
                current,
                attribute: kAXSelectedChildrenAttribute as CFString
            ))
            var seen = Set<CFHashCode>()
            let unique = selected.filter { seen.insert(CFHash($0)).inserted }.prefix(10)
            if !unique.isEmpty {
                let elements = unique.map(selectionSemanticElement)
                let key = unique.map { String(CFHash($0)) }.joined(separator: ":")
                return ("\(processIdentifier):\(key)", elements)
            }
            guard let parent = elementAttribute(current, attribute: kAXParentAttribute as CFString) else {
                break
            }
            current = parent
        }
        return nil
    }

    func semanticElement(at point: CGPoint) -> SemanticElement? {
        let systemWide = AXUIElementCreateSystemWide()
        var element: AXUIElement?
        guard AXUIElementCopyElementAtPosition(systemWide, Float(point.x), Float(point.y), &element) == .success,
              let element else { return nil }
        let actionableRoles = Set([
            "AXButton", "AXLink", "AXMenuItem", "AXCheckBox", "AXRadioButton",
            "AXTab", "AXRow", "AXCell", "AXPopUpButton"
        ])
        var current: AXUIElement? = element
        var fallback: SemanticElement?
        for _ in 0..<6 {
            guard let candidate = current else { break }
            let semantic = semanticElement(candidate, includeValue: false)
            fallback = fallback ?? semantic
            if actionableRoles.contains(semantic.role ?? "") || hasMeaningfulLabel(semantic) {
                return semantic
            }
            if semantic.role == "AXStaticText",
               let value = stringAttribute(candidate, attribute: kAXValueAttribute as CFString) {
                return SemanticElement(
                    role: semantic.role,
                    subrole: semantic.subrole,
                    title: semantic.title,
                    label: semantic.label,
                    identifier: semantic.identifier,
                    value: SemanticSanitizer.clipped(
                        redactedIfLikelySecret(normalize(value)),
                        limit: 240
                    )
                )
            }
            current = elementAttribute(candidate, attribute: kAXParentAttribute as CFString)
        }
        return fallback
    }

    func visibleText(processIdentifier: pid_t, limit: Int = 40) -> [String] {
        guard let root = focusedWindow(processIdentifier: processIdentifier) else { return [] }
        return visibleText(root: root, limit: limit)
    }

    func visibleText(root: AXUIElement, limit: Int = 40) -> [String] {
        var output: [String] = []
        var seen = Set<String>()
        var totalCharacters = 0
        appendSemanticText(
            from: root,
            maxNodes: 240,
            maxDepth: 6,
            limit: limit,
            output: &output,
            seen: &seen,
            totalCharacters: &totalCharacters
        )
        if output.count < limit,
           let webArea = firstDescendant(withRole: "AXWebArea", from: root, maxNodes: 360) {
            appendSemanticText(
                from: webArea,
                maxNodes: 480,
                maxDepth: 9,
                limit: limit,
                output: &output,
                seen: &seen,
                totalCharacters: &totalCharacters
            )
        }
        return output
    }

    private func appendSemanticText(
        from root: AXUIElement,
        maxNodes: Int,
        maxDepth: Int,
        limit: Int,
        output: inout [String],
        seen: inout Set<String>,
        totalCharacters: inout Int
    ) {
        let valueRoles = Set(["AXStaticText", "AXTextArea", "AXLink", "AXHeading", "AXCell", "AXRow"])
        var queue: [(AXUIElement, Int)] = [(root, 0)]
        var cursor = 0
        while cursor < queue.count,
              cursor < maxNodes,
              output.count < limit,
              totalCharacters < 6_000 {
            let (element, depth) = queue[cursor]
            cursor += 1
            let role = stringAttribute(element, attribute: kAXRoleAttribute as CFString)
            let subrole = stringAttribute(element, attribute: kAXSubroleAttribute as CFString)
            let secure = isSensitive(element, role: role, subrole: subrole)
            // Single-line form values are captured only when actively edited. Omitting them from
            // passive snapshots avoids persisting prefilled hosts, usernames, and account metadata.
            let semanticValue: String?
            if secure || role.map(valueRoles.contains) != true {
                semanticValue = nil
            } else if role == "AXTextArea" {
                semanticValue = visibleTextValue(element) ?? stringAttribute(
                    element,
                    attribute: kAXValueAttribute as CFString
                ).map {
                    SemanticSanitizer.boundedTextValue(
                        redactedIfLikelySecret($0),
                        limit: 240
                    )
                }
            } else {
                semanticValue = stringAttribute(element, attribute: kAXValueAttribute as CFString)
            }
            // Accessibility traversal order generally follows the visible interface. A strict
            // AXFrame filter proved unreliable in Electron and WebKit, where useful descendants
            // often report zero or missing frames, so visibility is approximated with hard node,
            // depth, item, and character bounds instead.
            let candidates = [
                stringAttribute(element, attribute: kAXTitleAttribute as CFString),
                stringAttribute(element, attribute: kAXDescriptionAttribute as CFString),
                role.map(valueRoles.contains) == true && !secure ? semanticValue : nil
            ]

            for candidate in candidates.compactMap({ $0 }) {
                let normalized = normalize(redactedIfLikelySecret(candidate))
                guard normalized.count >= 2, seen.insert(normalized).inserted else { continue }
                let clipped = SemanticSanitizer.clipped(normalized, limit: 240)
                output.append(clipped)
                totalCharacters += clipped.count
                if output.count >= limit || totalCharacters >= 6_000 { break }
            }

            if depth < maxDepth, queue.count < maxNodes {
                let remaining = maxNodes - queue.count
                queue.append(contentsOf: children(of: element).prefix(min(100, remaining)).map {
                    ($0, depth + 1)
                })
            }
        }
    }

    private func firstDescendant(
        withRole expectedRole: String,
        from root: AXUIElement,
        maxNodes: Int
    ) -> AXUIElement? {
        var queue: [AXUIElement] = [root]
        var cursor = 0
        while cursor < queue.count, cursor < maxNodes {
            let element = queue[cursor]
            cursor += 1
            if stringAttribute(element, attribute: kAXRoleAttribute as CFString) == expectedRole {
                return element
            }
            if queue.count < maxNodes {
                let remaining = maxNodes - queue.count
                queue.append(contentsOf: children(of: element).prefix(min(100, remaining)))
            }
        }
        return nil
    }

    func browserAddress(processIdentifier: pid_t) -> String? {
        guard let root = focusedWindow(processIdentifier: processIdentifier) else { return nil }
        return browserAddress(root: root)
    }

    func browserAddress(root: AXUIElement) -> String? {
        let maxNodes = 300
        var queue: [(AXUIElement, Int)] = [(root, 0)]
        var cursor = 0
        var directURLFallback: String?
        while cursor < queue.count, cursor < maxNodes {
            let (element, depth) = queue[cursor]
            cursor += 1
            let role = stringAttribute(element, attribute: kAXRoleAttribute as CFString)
            if role == "AXWebArea" || depth <= 2,
               let directURL = stringAttribute(element, attribute: kAXURLAttribute as CFString),
               directURL.hasPrefix("http") {
                directURLFallback = directURLFallback ?? directURL
            }
            let description = [
                stringAttribute(element, attribute: kAXDescriptionAttribute as CFString),
                stringAttribute(element, attribute: kAXTitleAttribute as CFString),
                stringAttribute(element, attribute: kAXHelpAttribute as CFString)
            ].compactMap { $0 }.joined(separator: " ").lowercased()
            let isAddressControl = ["AXTextField", "AXComboBox"].contains(role ?? "") &&
                (description.contains("address") || description.contains("location") || description.contains("search bar"))
            if isAddressControl,
               let value = stringAttribute(element, attribute: kAXValueAttribute as CFString),
               value.contains(".") {
                if value.hasPrefix("http://") || value.hasPrefix("https://") { return value }
                return "https://\(value)"
            }
            if depth < 7, queue.count < maxNodes {
                let remaining = maxNodes - queue.count
                queue.append(contentsOf: children(of: element).prefix(min(100, remaining)).map { ($0, depth + 1) })
            }
        }
        return directURLFallback
    }

    func semanticElement(_ element: AXUIElement, includeValue: Bool) -> SemanticElement {
        let role = stringAttribute(element, attribute: kAXRoleAttribute as CFString)
        let subrole = stringAttribute(element, attribute: kAXSubroleAttribute as CFString)
        let secure = isSensitive(element, role: role, subrole: subrole)
        return SemanticElement(
            role: role,
            subrole: subrole,
            title: clippedAttribute(element, attribute: kAXTitleAttribute as CFString, limit: 500),
            label: clippedAttribute(element, attribute: kAXDescriptionAttribute as CFString, limit: 500)
                ?? clippedAttribute(element, attribute: kAXHelpAttribute as CFString, limit: 500),
            identifier: clippedAttribute(element, attribute: kAXIdentifierAttribute as CFString, limit: 300),
            value: includeValue && !secure
                ? clippedAttribute(element, attribute: kAXValueAttribute as CFString, limit: 1_000)
                : nil
        )
    }

    private func clippedAttribute(_ element: AXUIElement, attribute: CFString, limit: Int) -> String? {
        stringAttribute(element, attribute: attribute).map {
            SemanticSanitizer.clipped(
                redactedIfLikelySecret(normalize($0)),
                limit: limit
            )
        }
    }

    private func hasMeaningfulLabel(_ element: SemanticElement) -> Bool {
        if [element.title, element.label].contains(where: { value in
            value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }) { return true }
        guard let identifier = element.identifier?.trimmingCharacters(in: .whitespacesAndNewlines),
              !identifier.isEmpty else { return false }
        return !identifier.hasPrefix("_NS:")
    }

    private func isSensitive(_ element: AXUIElement, role: String?, subrole: String?) -> Bool {
        SemanticSanitizer.isSensitiveTextField(role: role, subrole: subrole, metadata: [
            stringAttribute(element, attribute: kAXTitleAttribute as CFString),
            stringAttribute(element, attribute: kAXDescriptionAttribute as CFString),
            stringAttribute(element, attribute: kAXHelpAttribute as CFString),
            stringAttribute(element, attribute: kAXIdentifierAttribute as CFString)
        ])
    }

    private func stringAttribute(_ element: AXUIElement, attribute: CFString) -> String? {
        guard let value = copyAttribute(element, attribute: attribute) else { return nil }
        if let string = value as? String { return string }
        if let url = value as? URL { return url.absoluteString }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private func numberAttribute(_ element: AXUIElement, attribute: CFString) -> Int? {
        guard let value = copyAttribute(element, attribute: attribute) else { return nil }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }

    private func elementAttribute(_ element: AXUIElement, attribute: CFString) -> AXUIElement? {
        guard let value = copyAttribute(element, attribute: attribute),
              CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    private func elementsAttribute(_ element: AXUIElement, attribute: CFString) -> [AXUIElement] {
        guard let value = copyAttribute(element, attribute: attribute),
              let values = value as? [CFTypeRef] else { return [] }
        return values.compactMap { value in
            guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
            return unsafeDowncast(value, to: AXUIElement.self)
        }
    }

    private func selectionSemanticElement(_ element: AXUIElement) -> SemanticElement {
        let direct = semanticElement(element, includeValue: false)
        if hasMeaningfulLabel(direct) { return direct }
        var queue: [(AXUIElement, Int)] = children(of: element).prefix(20).map { ($0, 1) }
        var cursor = 0
        while cursor < queue.count, cursor < 40 {
            let (child, depth) = queue[cursor]
            cursor += 1
            let semantic = semanticElement(child, includeValue: true)
            if hasMeaningfulLabel(semantic) || semantic.value?.isEmpty == false { return semantic }
            if depth < 2 {
                queue.append(contentsOf: children(of: child).prefix(20).map { ($0, depth + 1) })
            }
        }
        return direct
    }

    private func visibleTextValue(_ element: AXUIElement) -> String? {
        guard let rangeValue = copyAttribute(element, attribute: kAXVisibleCharacterRangeAttribute as CFString),
              CFGetTypeID(rangeValue) == AXValueGetTypeID() else {
            return nil
        }
        let axRange = unsafeDowncast(rangeValue, to: AXValue.self)
        guard AXValueGetType(axRange) == .cfRange else { return nil }
        var range = CFRange()
        guard AXValueGetValue(axRange, .cfRange, &range) else { return nil }
        range.length = min(range.length, 1_200)
        guard let boundedRange = AXValueCreate(.cfRange, &range) else { return nil }
        var value: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXStringForRangeParameterizedAttribute as CFString,
            boundedRange,
            &value
        ) == .success else { return nil }
        return value as? String
    }

    private func redactedIfLikelySecret(_ value: String) -> String {
        SemanticSanitizer.redactedIfLikelySecret(
            value,
            redactEmailAddresses: redactEmailAddresses
        )
    }

    private func selectedTextSample(_ element: AXUIElement) -> (
        regionKey: String,
        value: String,
        regionStart: Int,
        selectionLocation: Int,
        selectionLength: Int,
        characterCount: Int
    )? {
        guard let selectedRangeValue = copyAttribute(
            element,
            attribute: kAXSelectedTextRangeAttribute as CFString
        ), CFGetTypeID(selectedRangeValue) == AXValueGetTypeID() else { return nil }
        let axSelectedRange = unsafeDowncast(selectedRangeValue, to: AXValue.self)
        guard AXValueGetType(axSelectedRange) == .cfRange else { return nil }
        var selectedRange = CFRange()
        guard AXValueGetValue(axSelectedRange, .cfRange, &selectedRange) else { return nil }

        let bucketSize = 400
        let regionStart = max(0, (selectedRange.location / bucketSize) * bucketSize - 200)
        guard let characterCount = numberAttribute(
            element,
            attribute: kAXNumberOfCharactersAttribute as CFString
        ) else { return nil }
        let regionLength = min(1_600, max(0, characterCount - regionStart))
        if regionLength == 0 {
            // Keep the same region key before and after the first character so an empty
            // composer remains the baseline instead of silently dropping its first edit.
            return (
                "region-\(regionStart)",
                "",
                regionStart,
                selectedRange.location,
                selectedRange.length,
                characterCount
            )
        }
        var region = CFRange(location: regionStart, length: regionLength)
        guard let regionValue = AXValueCreate(.cfRange, &region) else { return nil }
        var value: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(
            element,
            kAXStringForRangeParameterizedAttribute as CFString,
            regionValue,
            &value
        ) == .success, let string = value as? String else { return nil }
        return (
            "region-\(regionStart)",
            string,
            regionStart,
            selectedRange.location,
            selectedRange.length,
            characterCount
        )
    }

    private func copyAttribute(_ element: AXUIElement, attribute: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
        return value
    }

    private func booleanAttribute(_ element: AXUIElement, attribute: CFString) -> Bool? {
        (copyAttribute(element, attribute: attribute) as? NSNumber)?.boolValue
    }

    private func belongsToProcess(_ element: AXUIElement, processIdentifier: pid_t) -> Bool {
        var elementProcessIdentifier = pid_t()
        return AXUIElementGetPid(element, &elementProcessIdentifier) == .success &&
            elementProcessIdentifier == processIdentifier
    }

    /// Chromium editors can remain reachable in the AX tree even when both focused-element
    /// attributes return no value. Search only the requested application's descendants and
    /// accept only an editable element whose AXFocused flag and PID both match.
    private func focusedEditableDescendant(
        application: AXUIElement,
        processIdentifier: pid_t
    ) -> AXUIElement? {
        var queue: [(element: AXUIElement, depth: Int)] = []
        queue.append(contentsOf: elementsAttribute(
            application,
            attribute: kAXWindowsAttribute as CFString
        ).map { ($0, 0) })
        queue.append(contentsOf: children(of: application).map { ($0, 0) })
        var seen = Set<CFHashCode>()
        var cursor = 0
        let maximumNodes = 240
        let maximumDepth = 12

        while cursor < queue.count, cursor < maximumNodes {
            let candidate = queue[cursor]
            cursor += 1
            guard seen.insert(CFHash(candidate.element)).inserted else { continue }
            if booleanAttribute(candidate.element, attribute: kAXFocusedAttribute as CFString) == true,
               isEditableElement(candidate.element),
               belongsToProcess(candidate.element, processIdentifier: processIdentifier) {
                return candidate.element
            }
            guard candidate.depth < maximumDepth else { continue }
            queue.append(contentsOf: children(of: candidate.element).map {
                ($0, candidate.depth + 1)
            })
        }
        return nil
    }

    private func isEditableElement(_ element: AXUIElement) -> Bool {
        let role = stringAttribute(element, attribute: kAXRoleAttribute as CFString)
        let subrole = stringAttribute(element, attribute: kAXSubroleAttribute as CFString)
        let editableRoles = Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"])
        if role.map(editableRoles.contains) == true || subrole == "AXSearchField" {
            return true
        }
        let editableContainerRoles = Set(["AXGroup", "AXWebArea", "AXUnknown"])
        return role.map(editableContainerRoles.contains) == true &&
            isAttributeSettable(element, attribute: kAXValueAttribute as CFString)
    }

    private func isAttributeSettable(_ element: AXUIElement, attribute: CFString) -> Bool {
        var settable = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(element, attribute, &settable) == .success && settable.boolValue
    }

    private func children(of element: AXUIElement) -> [AXUIElement] {
        guard let value = copyAttribute(element, attribute: kAXChildrenAttribute as CFString),
              let values = value as? [CFTypeRef] else { return [] }
        return values.compactMap { value in
            guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
            return unsafeDowncast(value, to: AXUIElement.self)
        }
    }

    private func prepareApplication(processIdentifier: pid_t) {
        guard enhancedProcessIdentifiers.insert(processIdentifier).inserted else { return }
        let application = AXUIElementCreateApplication(processIdentifier)
        _ = AXUIElementSetAttributeValue(
            application,
            "AXEnhancedUserInterface" as CFString,
            NSNumber(value: true)
        )
    }

    private func normalize(_ value: String) -> String {
        value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
