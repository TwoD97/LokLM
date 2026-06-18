# LokLM — Projekthandbuch

**Lokaler KI-Wissensassistent mit Quellenverifikation**

---

## Projekt

| Feld               | Angabe                                                       |
| ------------------ | ------------------------------------------------------------ |
| **Projekttitel**   | LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation  |
| **Dokumenttyp**    | Projekthandbuch                                              |
| **Version**        | 0.1 (Handbuch)                                               |
| **Projektstatus**  | nach ca. 9 Wochen Projektarbeit (Status-Snapshot 2026-06-14) |
| **Dokument-Stand** | 2026-06-16 (App-/Code-Stand v0.4.7, `d35e219`)               |
| **Auftraggeber**   | Landesberufsschule 4 Salzburg (Betreuer: Christoph Wirrer)   |

---

## Team

| Name               | Rolle                         | Verantwortungsbereich                                                                            |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| **Denys Tudosa**   | Projekt-Owner                 | Chunking, Authentifizierung/Krypto, RAG-Core, Installer/Release, Quiz, Transkription, QA-Routing |
| **Dominik Furlan** | Dokumentations-Owner & Tester | Dokumentation, Testabdeckung (Unit/Integration/Eval), UI/UX (Suche, Settings)                    |

Verbindliche Schreibweise: **Denys Tudosa** (Lasten-/Pflichtenheft); die Projektstatusberichte verwenden abweichend „Denis".

---

## Repository

| Feld           | Angabe                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Repository** | TwoD97/LokLM                                                                                                     |
| **Branch**     | dom/doku (Dokumentations-Arbeitsbranch)                                                                          |
| **Lizenz**     | MIT                                                                                                              |
| **Plattform**  | Windows 10/11 (64-bit), zusätzlich Linux-AppImage; macOS-Build-Pipeline vorhanden, Release noch nicht publiziert |

---

## Hinweis zur Version

Dieses Dokument ist die **Handbuch-Version 0.1**. Es bildet den **Projektstand nach ca. 9 Wochen Projektarbeit** (Stand 2026-06-14) ab und ist bewusst kein abgeschlossenes Endprodukt: Einzelne Arbeitspakete befinden sich in PR-Review oder in aktiver Umsetzung (siehe Kapitel 07 und die jeweiligen Statusangaben).

Eine spätere **gebundene PDF- bzw. Buch-Version** des Projekthandbuchs ist für die Schul-Abgabe vorgesehen. Sie wird den finalen Projektstand (inklusive abgeschlossener Test- und Eval-Säule sowie der GPU-Matrix-Auswertung) konsolidieren und in gedruckter Form eingereicht.

---

_Projekthandbuch LokLM · Version 0.1 · Stand 2026-06-16_
