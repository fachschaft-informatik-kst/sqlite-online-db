# SQLite Online DB (SQLime Fork für GitHub Pages)

Dieses Repository wurde auf Basis von [nalgeon/sqlime](https://github.com/nalgeon/sqlime) umgestellt, damit die Anwendung direkt über **GitHub Pages** für Studierende verfügbar ist.

## Ziel

- SQL-Playground im Browser ohne Serverbetrieb
- Direkte Bereitstellung unter GitHub Pages
- Basis ist ein Fork von SQLime

## GitHub Pages aktivieren

1. Repository öffnen → **Settings** → **Pages**
2. Unter **Source**: Branch `main` und Ordner `/ (root)` wählen
3. Speichern
4. Die Anwendung ist danach unter `https://<org>.github.io/<repo>/` erreichbar

## Hinweise zur Fork-Basis

- Codebasis stammt aus SQLime und wurde für Projekt-Pfade auf GitHub Pages angepasst (relative Asset-Pfade statt Root-Pfade).
- Wenn ihr mit einem eigenen SQLime-Fork synchronisieren wollt, übernehmt regelmäßig die Änderungen aus dem Upstream-Projekt.

## Lokal testen

Einfach im Repo-Verzeichnis einen lokalen Server starten:

```bash
python -m http.server 8080
```

Dann im Browser öffnen: `http://localhost:8080`.
