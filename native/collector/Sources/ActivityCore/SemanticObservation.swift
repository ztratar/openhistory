import Foundation

public struct SemanticElement: Codable, Equatable, Sendable {
    public let role: String?
    public let subrole: String?
    public let title: String?
    public let label: String?
    public let identifier: String?
    public let value: String?

    public init(
        role: String? = nil,
        subrole: String? = nil,
        title: String? = nil,
        label: String? = nil,
        identifier: String? = nil,
        value: String? = nil
    ) {
        self.role = role
        self.subrole = subrole
        self.title = title
        self.label = label
        self.identifier = identifier
        self.value = value
    }
}

public struct TextChange: Codable, Equatable, Sendable {
    public let insertedText: String
    public let deletedCharacterCount: Int
    public let resultingValue: String

    public init(insertedText: String, deletedCharacterCount: Int, resultingValue: String) {
        self.insertedText = insertedText
        self.deletedCharacterCount = deletedCharacterCount
        self.resultingValue = resultingValue
    }
}

public struct BrowserObservation: Codable, Equatable, Sendable {
    public let url: String
    public let domain: String
    public let title: String?

    public init(url: String, domain: String, title: String?) {
        self.url = url
        self.domain = domain
        self.title = title
    }
}

public struct DocumentObservation: Codable, Equatable, Sendable {
    public let displayPath: String
    public let name: String
    public let fileExtension: String?

    public init(displayPath: String, name: String, fileExtension: String?) {
        self.displayPath = displayPath
        self.name = name
        self.fileExtension = fileExtension
    }
}

public enum SemanticSanitizer {
    private static let preservedQueryKeys = Set(["q", "query", "search"])
    private static let sensitiveFieldPhrases = [
        "password", "passwd", "pwd", "passcode", "current-password", "new-password",
        "password-field", "secret", "api key", "access token", "auth token",
        "private key", "seed phrase", "recovery phrase", "credit card", "card number",
        "security code", "verification code", "one-time code", "one time code", "otp",
        "social security", "ssn", "cvv", "bank account", "routing number", "pin code",
        "encryption key", "webhook secret"
    ]
    private static let credentialPatterns = [
        #"(?i)\bsk-[a-z0-9_-]{12,}\b"#,
        #"(?i)\b[rs]k_(live|test)_[a-z0-9]{12,}\b"#,
        #"(?i)\bgh[pousr]_[a-z0-9]{20,}\b"#,
        #"(?i)\bglpat-[a-z0-9_-]{16,}\b"#,
        #"(?i)\bxox[baprs]-[a-z0-9-]{12,}\b"#,
        #"\bAKIA[0-9A-Z]{16}\b"#,
        #"(?i)\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b"#,
        #"(?i)\bBearer\s+[a-z0-9._~-]{16,}\b"#,
        #"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"#,
        #"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"#,
        #"(?i)\b(password|passwd|pwd|api[_ -]?key|token|secret)\s*[:=]\s*\S+"#,
        #"-----BEGIN [A-Z ]*PRIVATE KEY-----"#
    ]
    private static let connectionStringPattern =
        #"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@"#
    private static let emailPattern = #"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"#

    public static func browserObservation(
        rawURL: String,
        title: String?,
        redactEmailAddresses: Bool = true
    ) -> BrowserObservation? {
        guard var components = URLComponents(string: rawURL),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let domain = components.host?.lowercased() else { return nil }

        components.user = nil
        components.password = nil
        components.fragment = nil
        components.path = components.path.components(separatedBy: "/").map { segment in
            containsLikelySecret(segment.removingPercentEncoding ?? segment) ? "[redacted]" : segment
        }.joined(separator: "/")
        components.queryItems = components.queryItems?.map { item in
            if preservedQueryKeys.contains(item.name.lowercased()) {
                return URLQueryItem(
                    name: item.name,
                    value: redactedIfLikelySecret(
                        clipped(item.value ?? "", limit: 300),
                        redactEmailAddresses: redactEmailAddresses
                    )
                )
            }
            return URLQueryItem(name: item.name, value: "[redacted]")
        }

        guard let sanitizedURL = components.string else { return nil }
        return BrowserObservation(
            url: clipped(sanitizedURL, limit: 2_000),
            domain: domain,
            title: title.map {
                clipped(
                    redactedIfLikelySecret($0, redactEmailAddresses: redactEmailAddresses),
                    limit: 500
                )
            }
        )
    }

    public static func documentObservation(
        rawValue: String,
        redactEmailAddresses: Bool = true
    ) -> DocumentObservation? {
        let path: String
        if let url = URL(string: rawValue), url.scheme?.lowercased() == "file" {
            path = url.path
        } else if rawValue.hasPrefix("/") {
            path = rawValue
        } else {
            return nil
        }
        let components = path.split(separator: "/").map(String.init)
        guard let rawName = components.last, !rawName.isEmpty else { return nil }
        let rawDisplayPath = components.suffix(3).joined(separator: "/")
        let displayPath = redactedIfLikelySecret(
            rawDisplayPath,
            redactEmailAddresses: redactEmailAddresses
        )
        let name = redactedIfLikelySecret(rawName, redactEmailAddresses: redactEmailAddresses)
        let pathExtension = displayPath == "[redacted sensitive value]"
            ? nil
            : URL(fileURLWithPath: rawName).pathExtension.lowercased()
        return DocumentObservation(
            displayPath: clipped(displayPath, limit: 800),
            name: clipped(name, limit: 300),
            fileExtension: pathExtension?.isEmpty == false ? pathExtension : nil
        )
    }

    public static func textChange(
        from oldValue: String,
        to newValue: String,
        redactEmailAddresses: Bool = true
    ) -> TextChange {
        let oldCharacters = Array(boundedTextValue(oldValue, limit: 8_000))
        let newCharacters = Array(boundedTextValue(newValue, limit: 8_000))
        var prefix = 0
        while prefix < min(oldCharacters.count, newCharacters.count),
              oldCharacters[prefix] == newCharacters[prefix] {
            prefix += 1
        }

        var suffix = 0
        while suffix < min(oldCharacters.count - prefix, newCharacters.count - prefix),
              oldCharacters[oldCharacters.count - suffix - 1] == newCharacters[newCharacters.count - suffix - 1] {
            suffix += 1
        }

        let insertedEnd = newCharacters.count - suffix
        let inserted = prefix < insertedEnd ? String(newCharacters[prefix..<insertedEnd]) : ""
        return TextChange(
            insertedText: clipped(
                redactedIfLikelySecret(inserted, redactEmailAddresses: redactEmailAddresses),
                limit: 2_000
            ),
            deletedCharacterCount: max(0, oldCharacters.count - prefix - suffix),
            resultingValue: boundedTextValue(
                redactedIfLikelySecret(newValue, redactEmailAddresses: redactEmailAddresses),
                limit: 4_000
            )
        )
    }

    public static func caretTextChange(
        beforeValue: String,
        currentValue: String,
        regionStart: Int,
        beforeSelectionLocation: Int,
        currentSelectionLocation: Int,
        beforeSelectionLength: Int,
        beforeCharacterCount: Int,
        currentCharacterCount: Int,
        redactEmailAddresses: Bool = true
    ) -> TextChange? {
        guard !beforeValue.contains("[redacted"), !currentValue.contains("[redacted") else { return nil }
        let characterDelta = currentCharacterCount - beforeCharacterCount
        let insertedCount = beforeSelectionLength > 0
            ? max(0, currentSelectionLocation - beforeSelectionLocation)
            : max(0, characterDelta)
        let deletedCount = beforeSelectionLength > 0
            ? beforeSelectionLength
            : max(0, -characterDelta)
        guard insertedCount > 0 || deletedCount > 0 else { return nil }

        let relativeEnd = currentSelectionLocation - regionStart
        let relativeStart = relativeEnd - insertedCount
        let currentNSString = currentValue as NSString
        guard relativeStart >= 0,
              relativeEnd >= relativeStart,
              relativeEnd <= currentNSString.length else { return nil }
        let inserted = insertedCount > 0
            ? currentNSString.substring(with: NSRange(location: relativeStart, length: insertedCount))
            : ""
        return TextChange(
            insertedText: clipped(
                redactedIfLikelySecret(inserted, redactEmailAddresses: redactEmailAddresses),
                limit: 2_000
            ),
            deletedCharacterCount: deletedCount,
            resultingValue: boundedTextValue(
                redactedIfLikelySecret(currentValue, redactEmailAddresses: redactEmailAddresses),
                limit: 4_000
            )
        )
    }

    public static func isLikelyDocumentReplacement(
        from oldValue: String,
        to newValue: String,
        elementRole: String? = nil,
        redactEmailAddresses: Bool = true
    ) -> Bool {
        let change = textChange(
            from: oldValue,
            to: newValue,
            redactEmailAddresses: redactEmailAddresses
        )
        let largestDocument = max(oldValue.count, newValue.count)
        let minimumLength = elementRole == "AXTextArea" ? 20 : 500
        guard largestDocument >= minimumLength else { return false }
        let changedCharacters = change.deletedCharacterCount + change.insertedText.count
        return Double(changedCharacters) / Double(largestDocument) >= 0.75
    }

    public static func isSensitiveFieldMetadata(_ values: [String?]) -> Bool {
        let metadata = values.compactMap { $0 }.joined(separator: " ").lowercased()
        return sensitiveFieldPhrases.contains { metadata.contains($0) }
    }

    public static func isSensitiveTextField(
        role: String?,
        subrole: String?,
        metadata: [String?]
    ) -> Bool {
        if role?.localizedCaseInsensitiveContains("secure") == true ||
            subrole?.localizedCaseInsensitiveContains("secure") == true {
            return true
        }
        return isSensitiveFieldMetadata(metadata)
    }

    public static func containsLikelySecret(_ value: String) -> Bool {
        value.range(of: connectionStringPattern, options: .regularExpression) != nil ||
            credentialPatterns.contains { pattern in
            value.range(of: pattern, options: .regularExpression) != nil
        }
    }

    public static func redactedIfLikelySecret(
        _ value: String,
        redactEmailAddresses: Bool = true
    ) -> String {
        var redacted = value.replacingOccurrences(
            of: connectionStringPattern,
            with: "$1[redacted sensitive value]@",
            options: .regularExpression
        )
        for pattern in credentialPatterns {
            redacted = redacted.replacingOccurrences(
                of: pattern,
                with: "[redacted sensitive value]",
                options: .regularExpression
            )
        }
        redacted = redactedURLQueryValues(redacted)
        guard redactEmailAddresses else { return redacted }
        return redacted.replacingOccurrences(
            of: emailPattern,
            with: "[redacted email]",
            options: .regularExpression
        )
    }

    private static func redactedURLQueryValues(_ value: String) -> String {
        guard value.contains("?"), !value.contains(where: { $0.isWhitespace }) else { return value }
        let hasScheme = value.range(of: #"^[a-z][a-z0-9+.-]*://"#, options: [
            .regularExpression,
            .caseInsensitive
        ]) != nil
        guard var components = URLComponents(string: hasScheme ? value : "https://\(value)"),
              components.host != nil,
              components.queryItems?.isEmpty == false else { return value }
        components.queryItems = components.queryItems?.map {
            URLQueryItem(name: $0.name, value: "[redacted]")
        }
        guard var sanitized = components.string else { return value }
        if !hasScheme, sanitized.hasPrefix("https://") {
            sanitized.removeFirst("https://".count)
        }
        return sanitized
    }

    public static func boundedTextValue(_ value: String, limit: Int) -> String {
        guard value.count > limit else { return value }
        let marker = "\n[…truncated…]\n"
        guard limit > marker.count + 2 else { return clipped(value, limit: limit) }
        let available = limit - marker.count
        let headCount = available / 2
        let tailCount = available - headCount
        return String(value.prefix(headCount)) + marker + String(value.suffix(tailCount))
    }

    public static func clipped(_ value: String, limit: Int) -> String {
        guard value.count > limit else { return value }
        return String(value.prefix(limit)) + "…"
    }
}
