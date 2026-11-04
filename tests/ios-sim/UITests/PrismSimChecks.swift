import XCTest

/// Drives Settings and Safari on the simulator through the owner's checklist.
/// Pages report what they see to tests/ios-sim/server.mjs; the test waits on
/// those reports and attaches a screenshot at every step.
/// Tests run in name order: test1 turns the extension on for the rest.
final class PrismSimChecks: XCTestCase {
    static let base = "http://localhost:8080"
    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")

    override func setUp() {
        continueAfterFailure = true
    }

    // MARK: helpers

    func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func results() -> [String: [String: Any]] {
        let done = DispatchSemaphore(value: 0)
        var out: [String: [String: Any]] = [:]
        let task = URLSession.shared.dataTask(with: URL(string: Self.base + "/results")!) { data, _, _ in
            if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] {
                out = json
            }
            done.signal()
        }
        task.resume()
        _ = done.wait(timeout: .now() + 5)
        return out
    }

    /// The page's latest report for this visit once `condition` holds, or the last one seen.
    @discardableResult
    func waitFor(_ page: String, visit: String, timeout: TimeInterval,
                 _ condition: ([String: Any]) -> Bool) -> [String: Any]? {
        let end = Date().addingTimeInterval(timeout)
        var last: [String: Any]?
        while Date() < end {
            if let report = results()[page], report["visit"] as? String == visit {
                last = report
                if condition(report) { return report }
            }
            Thread.sleep(forTimeInterval: 1)
        }
        return last
    }

    func flag(_ report: [String: Any]?, _ key: String) -> Bool {
        (report?[key] as? Bool) ?? false
    }

    /// Opens a page in Safari with a fresh visit id, and waits for Prism's bubble on it.
    func open(_ path: String, page: String) -> String {
        let visit = "?run=\(UUID().uuidString.prefix(8))"
        XCUIDevice.shared.system.open(URL(string: Self.base + path + visit)!)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 30), "Safari didn't open")
        let ready = waitFor(page, visit: visit, timeout: 45) { self.flag($0, "bubblePresent") }
        shot("\(page)-loaded")
        XCTAssertTrue(flag(ready, "bubblePresent"), "Prism's bubble never appeared on \(page): is the extension on?")
        return visit
    }

    /// The bubble's ball: found by its label, else by its docked spot on the right edge.
    func ball() -> XCUIElement {
        let labels = ["Translate this page", "Show original", "Translating…", "Retry translation"]
        for label in labels {
            let button = safari.webViews.buttons[label]
            if button.exists { return button }
        }
        let predicate = NSPredicate(format: "label BEGINSWITH 'Translate' OR label BEGINSWITH 'Show original'")
        return safari.webViews.buttons.matching(predicate).firstMatch
    }

    func tapBall() {
        let button = ball()
        if button.waitForExistence(timeout: 5) && button.isHittable {
            button.tap()
        } else {
            let web = safari.webViews.firstMatch
            web.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.55)).tap()
        }
        // The bubble ignores a second tap within 600 ms, as a double-tap guard.
        Thread.sleep(forTimeInterval: 1.5)
    }

    func longPressBall() {
        let button = ball()
        if button.waitForExistence(timeout: 5) && button.isHittable {
            button.press(forDuration: 1.0)
        } else {
            safari.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.55))
                .press(forDuration: 1.0)
        }
        Thread.sleep(forTimeInterval: 1.5)
    }

    /// Taps a Settings row by its title, scrolling to it first.
    @discardableResult
    func tapRow(_ title: String, in app: XCUIApplication, required: Bool = true) -> Bool {
        let row = app.staticTexts[title].firstMatch
        var tries = 0
        while !(row.exists && row.isHittable) && tries < 12 {
            app.swipeUp()
            tries += 1
        }
        if !(row.exists && row.isHittable) {
            // Back to the top and look downwards once more.
            for _ in 0..<12 where !(row.exists && row.isHittable) { app.swipeDown() }
        }
        guard row.exists && row.isHittable else {
            if required { XCTFail("Settings row '\(title)' not found") }
            return false
        }
        row.tap()
        Thread.sleep(forTimeInterval: 1)
        return true
    }

    // MARK: checks

    func test1_turnOnTheExtension() {
        settings.launch()
        shot("settings-start")
        // iOS 18 and later list Safari under Apps; earlier versions at the top level.
        if settings.staticTexts["Apps"].waitForExistence(timeout: 5) {
            tapRow("Apps", in: settings)
        }
        tapRow("Safari", in: settings)
        shot("settings-safari")
        tapRow("Extensions", in: settings)
        shot("settings-extensions")
        tapRow("Prism", in: settings)
        shot("settings-prism")

        let toggle = settings.switches.firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "No switch on Prism's extension page")
        if (toggle.value as? String) == "0" { toggle.tap() }
        Thread.sleep(forTimeInterval: 1)

        for title in ["Other Websites", "All Websites"] where tapRow(title, in: settings, required: false) {
            tapRow("Allow", in: settings)
            settings.navigationBars.buttons.firstMatch.tap()
            break
        }
        shot("settings-prism-on")
        XCTAssertEqual(settings.switches.firstMatch.value as? String, "1", "Prism's extension switch is off")
    }

    func test2_chineseChapter() {
        let visit = open("/chinese-chapter.html", page: "chinese")
        tapBall()
        let done = waitFor("chinese", visit: visit, timeout: 90) { self.flag($0, "everAllTranslated") }
        shot("chinese-translated")
        XCTAssertTrue(flag(done, "everAllTranslated"), "Chinese chapter not fully translated: \(done ?? [:])")
        XCTAssertFalse(flag(done, "doubledBracket"), "A doubled bracket like （( is on the page")
        XCTAssertNil(done?["bubbleError"] as? String, "The bubble shows an error")

        tapBall()
        let back = waitFor("chinese", visit: visit, timeout: 30) { self.flag($0, "restoredExact") }
        shot("chinese-original")
        XCTAssertTrue(flag(back, "restoredExact"), "Show original didn't bring the exact text back")
    }

    func test3_longVietnameseChapter() {
        let visit = open("/vietnamese-long.html", page: "vietnamese")
        tapBall()
        let done = waitFor("vietnamese", visit: visit, timeout: 150) { self.flag($0, "everAllTranslated") }
        shot("vietnamese-translated")
        XCTAssertTrue(flag(done, "everAllTranslated"), "Long chapter not fully translated: \(done ?? [:])")
        XCTAssertNil(done?["bubbleError"] as? String, "The bubble shows an error or an untranslated warning")
        safari.swipeUp()
        safari.swipeUp()
        shot("vietnamese-translated-lower")
    }

    func test4_bubblePanelAndFromPicker() {
        let visit = open("/plain.html", page: "plain")
        longPressBall()
        let pinned = waitFor("plain", visit: visit, timeout: 10) { self.flag($0, "panelPinned") }
        shot("bubble-panel-pinned")
        XCTAssertTrue(flag(pinned, "panelPinned"), "A long press didn't pin the bubble's panel open")
        XCTAssertEqual(pinned?["fromValue"] as? String, "auto", "The From picker doesn't start at Auto")

        tapBall()
        let closed = waitFor("plain", visit: visit, timeout: 10) { !self.flag($0, "panelPinned") }
        shot("bubble-panel-closed")
        XCTAssertFalse(flag(closed, "panelPinned"), "Tapping the ball didn't close the pinned panel")
        XCTAssertEqual(closed?["flips"] as? Int, 0, "Tapping the ball with the panel open translated the page")
    }

    func test5_selectToTranslate() {
        let visit = open("/plain.html", page: "plain")
        let paragraph = safari.webViews.staticTexts.matching(
            NSPredicate(format: "label CONTAINS 'bán hàng'")).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 10), "Paragraph to select not found")
        paragraph.press(forDuration: 1.2)
        let shown = waitFor("plain", visit: visit, timeout: 10) { self.flag($0, "selectionTrigger") }
        shot("selection-trigger")
        XCTAssertTrue(flag(shown, "selectionTrigger"), "Prism's translate button didn't appear for the selection")

        let trigger = safari.webViews.buttons["Translate selection"]
        if trigger.waitForExistence(timeout: 5) { trigger.tap() }
        let result = waitFor("plain", visit: visit, timeout: 30) { ($0["selectionResult"] as? String)?.isEmpty == false }
        shot("selection-result")
        XCTAssertNotNil(result?["selectionResult"] as? String, "No translation shown for the selection")
    }

    func test6_sameOriginIframe() {
        let visit = open("/iframe.html", page: "iframe")
        tapBall()
        let done = waitFor("iframe", visit: visit, timeout: 90) { self.flag($0, "everAllTranslated") }
        shot("iframe-translated")
        XCTAssertTrue(flag(done, "everAllTranslated"), "The page and its iframe weren't both translated: \(done ?? [:])")

        tapBall()
        let back = waitFor("iframe", visit: visit, timeout: 30) { self.flag($0, "restoredExact") }
        shot("iframe-original")
        XCTAssertTrue(flag(back, "restoredExact"), "Show original didn't restore the page and its iframe")
    }

    /// Screenshots only: Safari's menus change between iOS versions, so nothing here fails the run.
    func test7_popupAndSettingsScreens() {
        _ = open("/plain.html", page: "plain")
        for label in ["Page Menu", "Page Settings", "Format Options", "Website Settings"] {
            let menu = safari.buttons[label]
            if menu.exists && menu.isHittable {
                menu.tap()
                Thread.sleep(forTimeInterval: 1.5)
                shot("safari-page-menu")
                let prism = safari.buttons.matching(NSPredicate(format: "label CONTAINS 'Prism'")).firstMatch
                if prism.waitForExistence(timeout: 3) {
                    prism.tap()
                    Thread.sleep(forTimeInterval: 3)
                    shot("prism-popup")
                }
                break
            }
        }
        _ = open("/plain.html", page: "plain")
        longPressBall()
        for attempt in 1...2 {
            let settingsChip = safari.webViews.buttons["Settings"]
            if settingsChip.waitForExistence(timeout: 5) {
                settingsChip.tap()
                Thread.sleep(forTimeInterval: 3)
                shot("prism-settings-\(attempt)")
            }
            if attempt == 1 {
                _ = open("/plain.html", page: "plain")
                longPressBall()
            }
        }
        let tabs = safari.buttons.matching(NSPredicate(format: "label CONTAINS 'Tab'")).firstMatch
        if tabs.exists {
            tabs.tap()
            Thread.sleep(forTimeInterval: 2)
            shot("safari-tabs")
        }
    }
}
