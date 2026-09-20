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
    
    // Suche flexibel nach Trackpoints, Waypoints oder Routepoints
    let pts = xmlDoc.querySelectorAll("trkpt");
    if (pts.length === 0) pts = xmlDoc.querySelectorAll("wpt");
    if (pts.length === 0) pts = xmlDoc.querySelectorAll("rtept");

    if (pts.length === 0) {
        alert("Keine gültigen Koordinaten in der GPX-Datei gefunden!");
        return;
    }

    document.getElementById('gpxStatus').textContent = `${pts.length} Punkte gefunden. Verarbeite...`;
    
    // Downsampling auf max. 300 Punkte, damit der Speicher nicht überläuft
    const maxPoints = 300;
    const step = Math.max(1, Math.floor(pts.length / maxPoints));
    let points = [];

    for (let i = 0; i < pts.length; i += step) {
        let lat = parseFloat(pts[i].getAttribute("lat")).toFixed(5);
        let lon = parseFloat(pts[i].getAttribute("lon")).toFixed(5);
        points.push(`${lat},${lon}`);
    }

    console.log(`Sende ${points.length} Punkte an den ESP32...`);
    await streamGPXToESP32(points);
});

async function streamGPXToESP32(points) {
    const progressBar = document.getElementById('gpxProgress');
    progressBar.style.display = 'block';
    progressBar.value = 0;

    const encoder = new TextEncoder();

    try {
        // Signal: Speicher auf ESP32 leeren
        await gpxChar.writeValueWithResponse(encoder.encode("START"));
        await new Promise(r => setTimeout(r, 200));

        // Punkte einzeln übertragen
        for (let i = 0; i < points.length; i++) {
            const chunk = `P:${points[i]}`;
            
            // Nutze writeValueWithResponse für garantierte Übertragung Paket für Paket
            await gpxChar.writeValueWithResponse(encoder.encode(chunk));
            
            progressBar.value = Math.round(((i + 1) / points.length) * 100);
            await new Promise(r => setTimeout(r, 20)); // Kleine Pause
        }

        // Signal: Übertragung beendet
        await gpxChar.writeValueWithResponse(encoder.encode("END"));
        document.getElementById('gpxStatus').textContent = `Route geladen (${points.length} Punkte)!`;
    } catch (err) {
        console.error("Fehler beim GPX-Streaming:", err);
        alert("Übertragungsfehler: " + err.message);
    } finally {
        progressBar.style.display = 'none';
    }
}
