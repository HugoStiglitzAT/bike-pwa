// UUIDs (Müssen exakt mit dem ESP32 C++ Code übereinstimmen)
const SERVICE_UUID        = "19b10000-e8f2-537e-4f6c-d104768a1214";
const TELEMETRY_CHAR_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";
const GPX_CHAR_UUID       = "19b10002-e8f2-537e-4f6c-d104768a1214";

// Bluetooth Variablen
let bleDevice = null;
let telemetryChar = null;
let gpxChar = null;

// Telemetrie Werte
let currentSpeed = 0.0;
let currentHR = 0;
let currentHeading = 0;
let currentLat = 0.0;
let currentLon = 0.0;

// --- 1. LilyGO per Web Bluetooth verbinden ---
document.getElementById('btnConnect').addEventListener('click', async () => {
    try {
        console.log("Suche nach BLE-Gerät...");
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'LilyGO-BikeComp' }],
            optionalServices: [SERVICE_UUID]
        });

        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        
        telemetryChar = await service.getCharacteristic(TELEMETRY_CHAR_UUID);
        gpxChar = await service.getCharacteristic(GPX_CHAR_UUID);

        document.getElementById('bleStatus').textContent = "VERBUNDEN";
        document.getElementById('bleStatus').className = "status connected";

        // GPS Tracking starten sobald BLE verbunden ist
        startGPSTracking();

        // Sekündliches Senden der Telemetrie starten
        setInterval(sendTelemetry, 1000);

    } catch (error) {
        console.error("BLE Fehler:", error);
        alert("Verbindung fehlgeschlagen: " + error);
    }
});

function onDisconnected() {
    document.getElementById('bleStatus').textContent = "GETRENNT";
    document.getElementById('bleStatus').className = "status";
}

// --- 2. GPS & Geschwindigkeit vom Smartphone (Web Geolocation API) ---
function startGPSTracking() {
    if ('geolocation' in navigator) {
        navigator.geolocation.watchPosition((pos) => {
            currentLat = pos.coords.latitude;
            currentLon = pos.coords.longitude;
            
            // m/s in km/h umrechnen (falls verfügbar)
            if (pos.coords.speed !== null && pos.coords.speed >= 0) {
                currentSpeed = (pos.coords.speed * 3.6).toFixed(1);
            } else {
                currentSpeed = 0.0;
            }

            if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
                currentHeading = Math.round(pos.coords.heading);
            }

            document.getElementById('valSpeed').textContent = `${currentSpeed} km/h`;
        }, (err) => {
            console.warn("GPS-Fehler:", err.message);
        }, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        });
    }
}

// --- 3. Optional: Externen Bluetooth-Pulsgurt / Smartwatch direkt koppeln ---
document.getElementById('btnHR').addEventListener('click', async () => {
    try {
        // Standard Bluetooth Heart Rate Service (0x180D)
        const hrDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: ['heart_rate'] }]
        });
        const server = await hrDevice.gatt.connect();
        const service = await server.getPrimaryService('heart_rate');
        const char = await service.getCharacteristic('heart_rate_measurement');

        await char.startNotifications();
        char.addEventListener('characteristicvaluechanged', (e) => {
            const val = e.target.value;
            // Standard BLE Heart Rate Parsing Protocol
            const flags = val.getUint8(0);
            let hr = (flags & 0x01) ? val.getUint16(1, true) : val.getUint8(1);
            currentHR = hr;
            document.getElementById('valHR').textContent = `${currentHR} bpm`;
        });
    } catch (err) {
        alert("Pulsgurt-Kopplung fehlgeschlagen: " + err);
    }
});

// --- 4. Daten-Packet an den ESP32 senden ---
async function sendTelemetry() {
    if (!telemetryChar || !bleDevice.gatt.connected) return;

    // Protokoll: SPEED|PULS|HEADING|LAT|LON
    const payload = `${currentSpeed}|${currentHR}|${currentHeading}|${currentLat}|${currentLon}`;
    
    try {
        const encoder = new TextEncoder();
        await telemetryChar.writeValueWithoutResponse(encoder.encode(payload));
    } catch (err) {
        console.error("Übertragungsfehler:", err);
    }
}