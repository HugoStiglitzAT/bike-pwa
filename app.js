const SERVICE_UUID        = "19b10000-e8f2-537e-4f6c-d104768a1214";
const TELEMETRY_CHAR_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";
const GPX_CHAR_UUID       = "19b10002-e8f2-537e-4f6c-d104768a1214";

let bleDevice = null;
let telemetryChar = null;
let gpxChar = null;

let currentSpeed = 0.0;
let currentHeading = 0;
let currentLat = 0.0;
let currentLon = 0.0;

// --- 1. BLE Verbindung ---
document.getElementById('btnConnect').addEventListener('click', async () => {
    try {
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'LilyGO-BikeComp' }],
            optionalServices: [SERVICE_UUID]
        });

        bleDevice.addEventListener('gattserverdisconnected', () => {
            document.getElementById('bleStatus').textContent = "GETRENNT";
            document.getElementById('bleStatus').className = "status";
        });

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        
        telemetryChar = await service.getCharacteristic(TELEMETRY_CHAR_UUID);
        gpxChar = await service.getCharacteristic(GPX_CHAR_UUID);

        document.getElementById('bleStatus').textContent = "VERBUNDEN";
        document.getElementById('bleStatus').className = "status connected";

        startGPSTracking();
        setInterval(sendTelemetry, 1000);

    } catch (error) {
        alert("Verbindung fehlgeschlagen: " + error);
    }
});

// --- 2. GPS Tracking ---
function startGPSTracking() {
    if ('geolocation' in navigator) {
        navigator.geolocation.watchPosition((pos) => {
            currentLat = pos.coords.latitude;
            currentLon = pos.coords.longitude;
            
            if (pos.coords.speed !== null && pos.coords.speed >= 0) {
                currentSpeed = (pos.coords.speed * 3.6).toFixed(1);
            } else {
                currentSpeed = 0.0;
            }

            if (pos.coords.heading !== null && !isNaN(pos.coords.heading)) {
                currentHeading = Math.round(pos.coords.heading);
            }

            document.getElementById('valSpeed').textContent = `${currentSpeed} km/h`;
        }, (err) => console.warn(err), { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
    }
}

// Telemetrie ohne Puls senden (Puls-Wert bleibt 0)
async function sendTelemetry() {
    if (!telemetryChar || !bleDevice.gatt.connected) return;

    // Format: SPEED|PULS|HEADING|LAT|LON
    const payload = `${currentSpeed}|0|${currentHeading}|${currentLat}|${currentLon}`;
    
    try {
        const encoder = new TextEncoder();
        await telemetryChar.writeValueWithoutResponse(encoder.encode(payload));
    } catch (err) {
        console.error("Übertragungsfehler:", err);
    }
}

// --- 3. GPX Datei Einlesen, Parsen & an ESP32 Streamen ---
document.getElementById('gpxInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!gpxChar || !bleDevice || !bleDevice.gatt.connected) {
        alert("Bitte zuerst das Display koppeln!");
        return;
    }

    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    const trkpts = xmlDoc.querySelectorAll("trkpt");

    if (trkpts.length === 0) {
        alert("Keine gültigen Wegpunkte in der GPX-Datei gefunden!");
        return;
    }

    document.getElementById('gpxStatus').textContent = `Lade ${trkpts.length} Punkte...`;
    
    // Max 500 Punkte für den ESP32 RAM-Speicher (Downsampling)
    const step = Math.max(1, Math.floor(trkpts.length / 500));
    let points = [];

    for (let i = 0; i < trkpts.length; i += step) {
        let lat = parseFloat(trkpts[i].getAttribute("lat")).toFixed(5);
        let lon = parseFloat(trkpts[i].getAttribute("lon")).toFixed(5);
        points.push(`${lat},${lon}`);
    }

    // GPX Stream starten
    await streamGPXToESP32(points);
});

async function streamGPXToESP32(points) {
    const progressBar = document.getElementById('gpxProgress');
    progressBar.style.display = 'block';
    progressBar.value = 0;

    const encoder = new TextEncoder();

    // Signal: Route starten (CLEAR)
    await gpxChar.writeValue(encoder.encode("START"));
    await new Promise(r => setTimeout(r, 100));

    // Punkte in Chunks senden
    for (let i = 0; i < points.length; i++) {
        const chunk = `P:${points[i]}`;
        await gpxChar.writeValue(encoder.encode(chunk));
        
        // Prozentfortschritt anzeigen
        progressBar.value = Math.round(((i + 1) / points.length) * 100);
        await new Promise(r => setTimeout(r, 30)); // 30ms Pause zwischen Paketen
    }

    // Signal: Route beendet (END)
    await gpxChar.writeValue(encoder.encode("END"));
    document.getElementById('gpxStatus').textContent = `Route geladen (${points.length} Punkte)!`;
    progressBar.style.display = 'none';
}
