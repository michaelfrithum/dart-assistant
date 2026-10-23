# Vorbereitung für michaelfrithum/dart-assistant

Dieses Archiv enthält die vorgesehenen Repository-Dateien, keinen Nachweis einer bereits erfolgten Veröffentlichung.

1. Die vom Inhaber gewählte MIT-Lizenz ist als LICENSE enthalten. Drittanbieter-Audio bleibt außerhalb des öffentlichen Repositories.
2. In einer HA-Testinstanz den Wechsel von 1.8.6 prüfen: Profile, Statistiken und Auswahl bleiben erhalten; alte manuelle Ressource entfernen.
3. Neuinstallation testen: Integration hinzufügen, Karte laden, eigenes Soundpaket importieren, Audio probehören, Match beenden und neu laden.
4. Öffentliches GitHub-Repository `dart-assistant` unter `michaelfrithum` anlegen. Beschreibung und Topics wie `home-assistant`, `hacs`, `darts` setzen.
5. Den **Inhalt** dieses Ordners auf die oberste Repository-Ebene hochladen; `custom_components` muss direkt im Repository liegen. Auch `.github` und `.gitignore` mitnehmen. Keine privaten ZIPs, MP3s, `.storage` oder HA-Konfiguration hinzufügen.
6. GitHub Actions abwarten. HACS- und Hassfest-Fehler vor dem Release beheben. Brands ist für den Start als benutzerdefiniertes Repository ausgenommen.
7. Release `v1.9.0-beta.1` als Vorabversion erstellen. Erst nach erfolgreichem HA-Test die Beta-Kennzeichnung entfernen und alle Versionsangaben gemeinsam aktualisieren.
8. Freund fügt das Repository in HACS als **Integration** hinzu; Anleitung steht in README.md.

Für die Veröffentlichung wurde noch kein Browserzugriff oder GitHub-Zugriff verwendet. Die produktive HA-Installation wurde nicht verändert.
