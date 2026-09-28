import Foundation
import HealthKit
import Capacitor

/// Sends finished runs from Apple Health to Bulletproof Base.
///
/// iOS wakes the app when a new workout is saved (HealthKit background
/// delivery). An anchored query then finds only workouts we haven't sent
/// yet, and posts the runs to the runner's personal ingest link. The server
/// dedupes by start time, so sending a run twice is harmless.
final class HealthSync {
    static let shared = HealthSync()

    private let store = HKHealthStore()
    private let defaults = UserDefaults.standard
    private let endpointKey = "bb.ingestEndpoint"
    private let anchorKey = "bb.workoutAnchor"
    private let lastSyncKey = "bb.lastSync"
    private let lastCountKey = "bb.lastCount"
    private var observer: HKObserverQuery?
    private let backfillDays: Double = 90

    var endpoint: URL? {
        get { defaults.string(forKey: endpointKey).flatMap(URL.init(string:)) }
        set { defaults.set(newValue?.absoluteString, forKey: endpointKey) }
    }

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private var readTypes: Set<HKObjectType> {
        [HKObjectType.workoutType(),
         HKQuantityType(.distanceWalkingRunning),
         HKQuantityType(.heartRate)]
    }

    func requestAccess(_ done: @escaping (Bool, String?) -> Void) {
        guard isAvailable else { return done(false, "Health isn’t available on this device.") }
        store.requestAuthorization(toShare: [], read: readTypes) { ok, err in
            done(ok, err?.localizedDescription)
        }
    }

    /// Called at every launch (including background launches by HealthKit).
    func start() {
        guard isAvailable, endpoint != nil, observer == nil else { return }
        let type = HKObjectType.workoutType()
        let q = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, error in
            guard error == nil, let self else { completion(); return }
            self.syncNow { _, _ in completion() }
        }
        observer = q
        store.execute(q)
        store.enableBackgroundDelivery(for: type, frequency: .immediate) { _, _ in }
    }

    func stop() {
        if let q = observer { store.stop(q) }
        observer = nil
        store.disableAllBackgroundDelivery { _, _ in }
        endpoint = nil
        defaults.removeObject(forKey: anchorKey)
    }

    var status: [String: Any] {
        [
            "available": isAvailable,
            "connected": endpoint != nil,
            "lastSync": defaults.string(forKey: lastSyncKey) as Any,
            "lastCount": defaults.integer(forKey: lastCountKey),
        ]
    }

    private var anchor: HKQueryAnchor? {
        get {
            guard let data = defaults.data(forKey: anchorKey) else { return nil }
            return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
        }
        set {
            let data = newValue.flatMap { try? NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true) }
            defaults.set(data, forKey: anchorKey)
        }
    }

    /// Finds workouts not sent yet and posts the runs. `done(sent, error)`.
    func syncNow(_ done: @escaping (Int, String?) -> Void) {
        guard let url = endpoint else { return done(0, "Not connected.") }
        // First sync: go back 90 days so past runs fill in; after that the anchor
        // hands us only what's new.
        let since = Date().addingTimeInterval(-backfillDays * 86_400)
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil)
        let q = HKAnchoredObjectQuery(type: .workoutType(), predicate: predicate, anchor: anchor, limit: HKObjectQueryNoLimit) { [weak self] _, samples, _, newAnchor, error in
            guard let self else { return }
            if let error { return done(0, error.localizedDescription) }
            let runs = (samples as? [HKWorkout] ?? []).filter { $0.workoutActivityType == .running }
            guard !runs.isEmpty else {
                self.anchor = newAnchor
                self.markSynced(0)
                return done(0, nil)
            }
            self.post(runs.map(self.payload), to: url) { ok, message in
                if ok { self.anchor = newAnchor; self.markSynced(runs.count) }
                done(ok ? runs.count : 0, ok ? nil : message)
            }
        }
        store.execute(q)
    }

    private func markSynced(_ count: Int) {
        defaults.set(ISO8601DateFormatter().string(from: Date()), forKey: lastSyncKey)
        defaults.set(count, forKey: lastCountKey)
    }

    private func payload(_ w: HKWorkout) -> [String: Any] {
        let iso = ISO8601DateFormatter()
        iso.timeZone = .current
        iso.formatOptions = [.withInternetDateTime]
        var p: [String: Any] = [
            "name": w.workoutActivityType == .running ? "Running" : "Workout",
            "start": iso.string(from: w.startDate),
            "end": iso.string(from: w.endDate),
            "duration": Int(w.duration.rounded()),
        ]
        let miles = w.statistics(for: HKQuantityType(.distanceWalkingRunning))?.sumQuantity()?.doubleValue(for: .mile())
            ?? w.totalDistance?.doubleValue(for: .mile())
        if let miles { p["distance"] = ["qty": (miles * 100).rounded() / 100, "units": "mi"] }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        if let hr = w.statistics(for: HKQuantityType(.heartRate)) {
            if let avg = hr.averageQuantity()?.doubleValue(for: bpm) { p["avgHeartRate"] = ["qty": avg.rounded(), "units": "bpm"] }
            if let max = hr.maximumQuantity()?.doubleValue(for: bpm) { p["maxHeartRate"] = ["qty": max.rounded(), "units": "bpm"] }
        }
        return p
    }

    private func post(_ workouts: [[String: Any]], to url: URL, done: @escaping (Bool, String?) -> Void) {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["workouts": workouts])
        // Keep running long enough to finish the upload if iOS woke us in the background.
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask { UIApplication.shared.endBackgroundTask(task) }
        URLSession.shared.dataTask(with: req) { data, resp, err in
            defer { UIApplication.shared.endBackgroundTask(task) }
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            done(err == nil && (200..<300).contains(code), err?.localizedDescription ?? body)
        }.resume()
    }
}

/// JavaScript bridge: window.Capacitor.Plugins.HealthSync
@objc(HealthSyncPlugin)
public class HealthSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthSyncPlugin"
    public let jsName = "HealthSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncNow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
    ]

    @objc func status(_ call: CAPPluginCall) { call.resolve(HealthSync.shared.status) }

    /// connect({ endpoint }) → asks for Health access, starts background sync,
    /// and sends the last 90 days of runs.
    @objc func connect(_ call: CAPPluginCall) {
        guard let s = call.getString("endpoint"), let url = URL(string: s) else { return call.reject("Missing link") }
        let sync = HealthSync.shared
        sync.requestAccess { ok, err in
            guard ok else { return call.reject(err ?? "Health access wasn’t allowed.") }
            sync.endpoint = url
            sync.start()
            sync.syncNow { sent, err in
                if let err { call.reject(err) } else { call.resolve(["sent": sent]) }
            }
        }
    }

    @objc func syncNow(_ call: CAPPluginCall) {
        HealthSync.shared.syncNow { sent, err in
            if let err { call.reject(err) } else { call.resolve(["sent": sent]) }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        HealthSync.shared.stop()
        call.resolve()
    }
}

/// Registers the app's own plugin with the Capacitor bridge.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthSyncPlugin())
    }
}
