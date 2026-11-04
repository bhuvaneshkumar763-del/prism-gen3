import SwiftUI

// UI tests need a host app; the tests themselves drive Settings and Safari.
@main
struct HostApp: App {
    var body: some Scene {
        WindowGroup { Text("Prism simulator checks") }
    }
}
