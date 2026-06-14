# Literaturverzeichnis

Nummerierte Liste der **externen Quellen** (Tools, Frameworks/Bibliotheken,
Standards/Normen, Spezifikationen, Paper, Online-Doku), die im Handbuch im
**IEEE-numerischen Stil** `[n]` zitiert werden. Interne Belege (eigener Code, ADRs,
committete Docs) gehören **nicht** hierher, sondern als Repo-Dateipfad in den Text und in
die [SOURCE_MAP.md](SOURCE_MAP.md).

Dieses Verzeichnis **wächst mit**: Sobald ein Kapitel eine externe Quelle mit `[n]` belegt,
wird der Eintrag hier in **Erscheinungsreihenfolge im Text** ergänzt. Vollständigkeit prüft
das [v1.0.0-Audit](RELEASE_AUDIT.md).

---

## Eintragsformat (IEEE)

```text
[n] Autor/Organisation, „Titel," Quelle/Version, Jahr. URL/DOI (Zugriff: JJJJ-MM-TT).
```

Beispiele für die später zu zitierenden Quelltypen:

- **Bibliothek/Framework:** Organisation, „Name, Version," Projekt-/Doku-Seite, Jahr. URL.
- **Standard/Norm:** Gremium, „Norm-Nummer: Titel," Jahr.
- **Paper:** Autoren, „Titel," Konferenz/Journal, Jahr. DOI.

---

## Einträge

> **Hinweis:** Software-Einträge tragen die **exakte Version aus `package.json`** (Stand
> 2026-06-14) und sind über die angegebene Bezugsquelle nachprüfbar. Bibliografische Details
> der wissenschaftlichen Quellen und Normen sind nach bestem Wissen zusammengestellt; vor
> der Bindung am Original gegenzuprüfen ([RELEASE_AUDIT.md](RELEASE_AUDIT.md) §3). Die
> Nummerierung wird beim v1.0-Audit auf strikte Erscheinungsreihenfolge konsolidiert.

[1] Electron-Projekt, „Electron, Version 42," OpenJS Foundation. [Online]. Verfügbar: <https://www.npmjs.com/package/electron> (Zugriff: 2026-06-14).

[2] node-llama-cpp-Projekt, „node-llama-cpp, Version 3.18.1," npm-Registry. [Online]. Verfügbar: <https://www.npmjs.com/package/node-llama-cpp> (Zugriff: 2026-06-14).

[3] ElectricSQL, „PGlite (@electric-sql/pglite), Version 0.4.5," npm-Registry. [Online]. Verfügbar: <https://www.npmjs.com/package/@electric-sql/pglite> (Zugriff: 2026-06-14).

[4] pgvector-Projekt, „pgvector — Open-source vector similarity search for Postgres." [Online]. Verfügbar: <https://github.com/pgvector/pgvector> (Zugriff: 2026-06-14).

[5] Drizzle-Team, „Drizzle ORM (drizzle-orm), Version 0.45.2," npm-Registry. [Online]. Verfügbar: <https://www.npmjs.com/package/drizzle-orm> (Zugriff: 2026-06-14).

[6] A. Biryukov, D. Dinu, D. Khovratovich und S. Josefsson, „Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications," IETF RFC 9106, Sep. 2021.

[7] M. Dworkin, „Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC," NIST Special Publication 800-38D, Nov. 2007.

[8] G. V. Cormack, C. L. A. Clarke und S. Büttcher, „Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods," in Proc. 32nd ACM SIGIR, 2009, S. 758–759.
