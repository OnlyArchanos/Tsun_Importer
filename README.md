# Tsun Importer

A sleek, ultra-glassmorphic Chrome extension to bulk import your manga library (Comick `.csv` or Weebcentral/MangaUpdates `.txt`) directly into [Atsu.moe](https://atsu.moe).

## Features
* **Smart Mapping:** Uses Atsu's `tracker-map.json` with an API search fallback.
* **Duplicate Protection:** Automatically skips manga you already have bookmarked.
* **Chapter Sync:** Restores your "Continue Reading" progress (CSV only).
* **Auto-Resume:** Saves state locally to resume large imports if your tab closes.
* **Error Logging:** Generates a downloadable `.txt` log of any manga that failed to import.

## Installation
1. Download or clone this repository as a `.zip` and extract it.
2. Open your Chromium browser and go to `chrome://extensions/`.
3. Toggle **Developer mode** ON (top right corner).
4. Click **Load unpacked** and select the extracted folder.

## Usage
1. Open [Atsu.moe](https://atsu.moe) (ensure you are logged in).
2. Drag and drop your `.csv` or `.txt` file into the Tsun Importer panel.
3. Click **Start Import** and let it run.