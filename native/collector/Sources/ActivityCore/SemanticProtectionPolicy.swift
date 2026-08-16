import Foundation

public enum SemanticProtectionPolicy {
    // Generated from src/shared/privacy-policy-data.json. Keep this list in sync with the
    // TypeScript privacy gate so collection and summarization make the same decision.
    private static let protectedAdultWebDomains: Set<String> = [
        "adultfriendfinder.com",
        "bangbros.com",
        "beeg.com",
        "brazzers.com",
        "chaturbate.com",
        "erome.com",
        "fansly.com",
        "livejasmin.com",
        "motherless.com",
        "nhentai.net",
        "onlyfans.com",
        "porn.com",
        "pornhub.com",
        "redgifs.com",
        "redtube.com",
        "rule34.xxx",
        "spankbang.com",
        "stripchat.com",
        "tube8.com",
        "xhamster.com",
        "xnxx.com",
        "xvideos.com",
        "youporn.com"
    ]
    private static let transientSystemOverlays: Set<String> = [
        "com.apple.UserNotificationCenter",
        "com.apple.notificationcenterui"
    ]
    private static let mailApplications: Set<String> = [
        "com.apple.mail",
        "com.microsoft.Outlook"
    ]
    private static let protectedApplications: Set<String> = [
        "com.apple.MobileSMS",
        "com.apple.UserNotificationCenter",
        "com.apple.notificationcenterui",
        "com.tinyspeck.slackmacgap",
        "com.microsoft.teams",
        "com.microsoft.teams2",
        "com.hnc.Discord",
        "net.whatsapp.WhatsApp",
        "org.whispersystems.signal-desktop",
        "ru.keepcoder.Telegram",
        "org.telegram.desktop",
        "com.1password.1password",
        "com.agilebits.onepassword7",
        "com.apple.Passwords",
        "com.apple.keychainaccess",
        "com.bitwarden.desktop",
        "com.dashlane.Dashlane",
        "com.lastpass.LastPass"
    ]

    private static let mailWebDomains: Set<String> = [
        "mail.google.com",
        "outlook.live.com",
        "outlook.office.com",
        "mail.yahoo.com",
        "mail.proton.me",
        "mail.icloud.com",
        "app.fastmail.com"
    ]
    private static let protectedWebDomains: Set<String> = [
        "messages.google.com",
        "app.slack.com",
        "chat.google.com",
        "teams.microsoft.com",
        "discord.com",
        "web.whatsapp.com",
        "web.telegram.org",
        "messenger.com",
        "chat.reddit.com"
    ]

    public static let browserApplications: Set<String> = [
        "com.google.Chrome",
        "com.google.Chrome.beta",
        "com.google.Chrome.canary",
        "com.apple.Safari",
        "com.microsoft.edgemac",
        "com.brave.Browser",
        "org.mozilla.firefox",
        "org.mozilla.firefoxdeveloperedition",
        "org.chromium.Chromium",
        "company.thebrowser.Browser",
        "com.vivaldi.Vivaldi",
        "com.operasoftware.Opera"
    ]

    public static func protectsApplication(
        bundleIdentifier: String,
        captureEmailActivity: Bool = false
    ) -> Bool {
        protectedApplications.contains(bundleIdentifier) ||
            (!captureEmailActivity && mailApplications.contains(bundleIdentifier))
    }

    public static func isTransientSystemOverlay(bundleIdentifier: String) -> Bool {
        transientSystemOverlays.contains(bundleIdentifier)
    }

    public static func protectsPrivateBrowsingWindow(title: String?) -> Bool {
        guard let title = title?.lowercased() else { return false }
        return title.contains("incognito") ||
            title.contains("private browsing") ||
            title.contains("inprivate")
    }

    public static func protectsBrowserObservation(
        _ observation: BrowserObservation,
        captureEmailActivity: Bool = false
    ) -> Bool {
        if !captureEmailActivity,
           mailWebDomains.contains(where: { domainMatches(observation.domain, $0) }) {
            return true
        }
        if protectedWebDomains.union(protectedAdultWebDomains).contains(where: {
            domainMatches(normalizedDomain(observation.domain), $0)
        }) {
            return true
        }

        guard let components = URLComponents(string: observation.url) else { return false }
        let path = components.path.lowercased()
        let domain = normalizedDomain(observation.domain)
        return (["x.com", "twitter.com"].contains(domain) && path.hasPrefix("/messages")) ||
            (domainMatches(domain, "facebook.com") && path.hasPrefix("/messages")) ||
            (domainMatches(domain, "linkedin.com") && path.hasPrefix("/messaging")) ||
            (domainMatches(domain, "instagram.com") && path.hasPrefix("/direct")) ||
            (domainMatches(domain, "reddit.com") && path.hasPrefix("/message"))
    }

    private static func domainMatches(_ domain: String, _ protectedDomain: String) -> Bool {
        domain == protectedDomain || domain.hasSuffix(".\(protectedDomain)")
    }

    private static func normalizedDomain(_ domain: String) -> String {
        domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }
}
