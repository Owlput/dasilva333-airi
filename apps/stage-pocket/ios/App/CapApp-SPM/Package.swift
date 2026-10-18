// swift-tools-version: 6.0
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
// NOTICE: CoreLLMKit entries below are a manual integration (NativeAI/CoreLLMKit
// local Swift package for on-device CoreML inference). `cap sync` regenerates
// this file from known Capacitor plugins only and drops them, so re-apply after
// every sync. See commit 4eb4fc8e5a.
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v18)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"),
        .package(name: "CapacitorLocalNotifications", path: "../../../../../node_modules/.pnpm/@capacitor+local-notifications@8.2.1_@capacitor+core@8.5.0/node_modules/@capacitor/local-notifications"),
        .package(name: "CapacitorNativeSettings", path: "../../../../../node_modules/.pnpm/capacitor-native-settings@8.2.0_@capacitor+core@8.5.0/node_modules/capacitor-native-settings"),
        .package(name: "CoreLLMKit", path: "../App/NativeAI/CoreLLMKit")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorLocalNotifications", package: "CapacitorLocalNotifications"),
                .product(name: "CapacitorNativeSettings", package: "CapacitorNativeSettings"),
                .product(name: "LLMCore", package: "CoreLLMKit"),
                .product(name: "CoreMLBackend", package: "CoreLLMKit")
            ]
        )
    ]
)
