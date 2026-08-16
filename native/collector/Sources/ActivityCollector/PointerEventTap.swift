import CoreGraphics
import Foundation

private func pointerEventTapCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let userInfo else { return Unmanaged.passUnretained(event) }
    let tap = Unmanaged<PointerEventTap>.fromOpaque(userInfo).takeUnretainedValue()
    tap.receive(type: type, event: event)
    return Unmanaged.passUnretained(event)
}

final class PointerEventTap: @unchecked Sendable {
    private var port: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private let handler: @Sendable (CGPoint) -> Void

    init?(handler: @escaping @Sendable (CGPoint) -> Void) {
        self.handler = handler
        let events: [CGEventType] = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        let mask = events.reduce(CGEventMask(0)) { partial, eventType in
            partial | (CGEventMask(1) << CGEventMask(eventType.rawValue))
        }
        guard let port = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: pointerEventTapCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return nil }

        self.port = port
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
        self.runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
    }

    deinit {
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        }
        if let port { CGEvent.tapEnable(tap: port, enable: false) }
    }

    fileprivate func receive(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let port { CGEvent.tapEnable(tap: port, enable: true) }
            return
        }
        handler(event.location)
    }
}
