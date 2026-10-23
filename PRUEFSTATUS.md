# Prüfstatus – 23.10.2026

- 24 isolierte Python-Tests erfolgreich: bisheriges Datenmodell, Einrichtung, YAML-Import, Singleton-Konfigurationsdialog, Deaktivieren und erneutes Einrichten, ZIP-Import, bestehende Dateien, Pfade, Symlinks und Größenlimits.
- Frontend-Test erfolgreich: ZIP-Auswahl verbunden, Upload an den richtigen WebSocket-Aufruf, Ergebnisanzeige, ungültige Dateiendungen, gebündeltes Standardlogo.
- JavaScript- und Python-Syntax geprüft.
- Echtes privates 1.8.6-Weitergabepaket importiert: 173 Caller-MP3s und 3 Sounds erkannt. Zweiter Import: keine neuen Dateien, 176 übersprungen.
- ZIP-Inhalt geprüft: kein fremdes Audio, keine HA-Daten oder Zugangsdaten, keine Python-Bytecodes.

Die HA-Schnittstellen wurden lokal mit Testdoubles geprüft. Noch ausstehend: echter HA-Neustart mit dieser Betaversion, Browserdarstellung/Audio dort sowie GitHub HACS- und Hassfest-Läufe. Die produktive HA-Instanz wurde nicht verändert. Nichts wurde auf GitHub veröffentlicht. Die MIT-Lizenz wurde vom Inhaber bestätigt und ergänzt.
