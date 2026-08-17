import ApplicationServices
import Foundation

enum AccessibilityEvent {
    case focusChanged(processIdentifier: pid_t)
    case valueChanged(processIdentifier: pid_t, element: AXUIElement)
    case selectedTextChanged(processIdentifier: pid_t, element: AXUIElement)
    case focusedElementDestroyed(processIdentifier: pid_t)
}

private func accessibilityObserverCallback(
    observer: AXObserver,
    element: AXUIElement,
    notification: CFString,
    reference: UnsafeMutableRawPointer?
) {
    guard let reference else { return }
    let monitor = Unmanaged<AccessibilityEventMonitor>.fromOpaque(reference).takeUnretainedValue()
    monitor.receive(observer: observer, element: element, notification: notification)
}

final class AccessibilityEventMonitor: @unchecked Sendable {
    private let handler: (AccessibilityEvent) -> Void
    private var observer: AXObserver?
    private var runLoopSource: CFRunLoopSource?
    private var applicationElement: AXUIElement?
    private var focusedElement: AXUIElement?
    private(set) var processIdentifier: pid_t?

    init(handler: @escaping (AccessibilityEvent) -> Void) {
        self.handler = handler
    }

    deinit {
        stop()
    }

    func bind(to processIdentifier: pid_t) {
        if self.processIdentifier == processIdentifier, observer != nil {
            rebindFocusedElement()
            return
        }

        stop()
        var createdObserver: AXObserver?
        guard AXObserverCreate(
            processIdentifier,
            accessibilityObserverCallback,
            &createdObserver
        ) == .success, let createdObserver else { return }

        let applicationElement = AXUIElementCreateApplication(processIdentifier)
        self.processIdentifier = processIdentifier
        self.observer = createdObserver
        self.applicationElement = applicationElement
        let runLoopSource = AXObserverGetRunLoopSource(createdObserver)
        self.runLoopSource = runLoopSource
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)

        addNotification(
            kAXFocusedUIElementChangedNotification as CFString,
            element: applicationElement
        )
        addNotification(
            kAXFocusedWindowChangedNotification as CFString,
            element: applicationElement
        )
        rebindFocusedElement()
    }

    func stop() {
        if let observer, let focusedElement {
            removeFocusedNotifications(observer: observer, element: focusedElement)
        }
        if let observer, let applicationElement {
            _ = AXObserverRemoveNotification(
                observer,
                applicationElement,
                kAXFocusedUIElementChangedNotification as CFString
            )
            _ = AXObserverRemoveNotification(
                observer,
                applicationElement,
                kAXFocusedWindowChangedNotification as CFString
            )
        }
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        }
        focusedElement = nil
        applicationElement = nil
        runLoopSource = nil
        observer = nil
        processIdentifier = nil
    }

    fileprivate func receive(
        observer: AXObserver,
        element: AXUIElement,
        notification: CFString
    ) {
        guard let currentObserver = self.observer,
              CFEqual(observer, currentObserver),
              let processIdentifier else { return }
        switch notification as String {
        case kAXFocusedUIElementChangedNotification, kAXFocusedWindowChangedNotification:
            rebindFocusedElement()
            handler(.focusChanged(processIdentifier: processIdentifier))
        case kAXValueChangedNotification:
            handler(.valueChanged(processIdentifier: processIdentifier, element: element))
        case kAXSelectedTextChangedNotification:
            handler(.selectedTextChanged(processIdentifier: processIdentifier, element: element))
        case kAXUIElementDestroyedNotification:
            focusedElement = nil
            handler(.focusedElementDestroyed(processIdentifier: processIdentifier))
            DispatchQueue.main.async { [weak self] in
                self?.rebindFocusedElement()
            }
        default:
            break
        }
    }

    private func rebindFocusedElement() {
        guard let observer, let applicationElement else { return }
        var value: CFTypeRef?
        let nextFocusedElement: AXUIElement?
        if AXUIElementCopyAttributeValue(
            applicationElement,
            kAXFocusedUIElementAttribute as CFString,
            &value
        ) == .success,
           let value,
           CFGetTypeID(value) == AXUIElementGetTypeID() {
            nextFocusedElement = unsafeDowncast(value, to: AXUIElement.self)
        } else {
            nextFocusedElement = nil
        }

        if let focusedElement, let nextFocusedElement, CFEqual(focusedElement, nextFocusedElement) {
            return
        }
        if let focusedElement {
            removeFocusedNotifications(observer: observer, element: focusedElement)
        }
        focusedElement = nextFocusedElement
        guard let nextFocusedElement else { return }
        addNotification(kAXValueChangedNotification as CFString, element: nextFocusedElement)
        addNotification(kAXSelectedTextChangedNotification as CFString, element: nextFocusedElement)
        addNotification(kAXUIElementDestroyedNotification as CFString, element: nextFocusedElement)
    }

    private func addNotification(_ notification: CFString, element: AXUIElement) {
        guard let observer else { return }
        _ = AXObserverAddNotification(
            observer,
            element,
            notification,
            Unmanaged.passUnretained(self).toOpaque()
        )
    }

    private func removeFocusedNotifications(observer: AXObserver, element: AXUIElement) {
        _ = AXObserverRemoveNotification(observer, element, kAXValueChangedNotification as CFString)
        _ = AXObserverRemoveNotification(observer, element, kAXSelectedTextChangedNotification as CFString)
        _ = AXObserverRemoveNotification(observer, element, kAXUIElementDestroyedNotification as CFString)
    }
}
