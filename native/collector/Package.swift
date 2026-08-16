// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "ActivityCollector",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ActivityCore", targets: ["ActivityCore"]),
        .library(name: "FoundationModelProtocol", targets: ["FoundationModelProtocol"]),
        .executable(name: "activity-collector", targets: ["ActivityCollector"]),
        .executable(name: "foundation-model-worker", targets: ["FoundationModelWorker"])
    ],
    targets: [
        .target(name: "ActivityCore"),
        .target(name: "FoundationModelProtocol"),
        .executableTarget(name: "ActivityCollector", dependencies: ["ActivityCore"]),
        .executableTarget(name: "FoundationModelWorker", dependencies: ["FoundationModelProtocol"]),
        .testTarget(name: "ActivityCoreTests", dependencies: ["ActivityCore"]),
        .testTarget(name: "FoundationModelProtocolTests", dependencies: ["FoundationModelProtocol"])
    ]
)
