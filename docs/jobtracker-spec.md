Produktziel und Scope

Die App soll alle Nebenjobs und ggf. einen Hauptjob einer Person zentral erfassen, Arbeitstage und -stunden tracken, daraus Brutto/Netto-Einkommen berechnen und gesetzliche/steuerliche Grenzen für 2026 automatisiert überwachen (z.B. Minijob-Grenze, 26‑Wochen‑Regel bei Kombination Werkstudent + kurzfristige Beschäftigung/Minijob).

Fokus der ersten Version ist eine PWA / Web-App, optimiert für iOS (Safari / Add to Home Screen, Touch-UI, Mobile-First Layout), kein nativer App-Store‑Release.

Zielplattform und technische Rahmenbedingungen

•	Frontend:

•	Responsive Web-App, primär Portrait-Layout für iPhone.

•	„App-like“ UX: Fullscreen PWA, Offline-Caching wo sinnvoll (z.B. letzte Einträge lokal halten).

•	UI-Struktur angelehnt an deinen bestehenden HTML-Prototyp (z.B. Card-basiertes Layout, klare Job‑Container, Tab-Navigation).

•	Backend:

•	Authentifizierter User-Account (E-Mail/Passwort oder OAuth).

•	Persistenz der Jobs, Zeitbuchungen und Einstellungen in einer zentralen DB.

•	Regel-Engine für Limits und Steuerlogik serverseitig, um sie versionierbar/aktualisierbar zu halten (Regeländerungen pro Jahr).

Onboarding und Job-Konfiguration

Beim ersten Start durchläuft der User ein Onboarding, in dem die gesamte Jobsituation erfasst wird.

•	Onboarding-Schritte:

•	Persönliche Basisdaten (optional, für Brutto/Netto-Genauigkeit: Steuerklasse, Bundesland, Kirchensteuer, Krankenversicherungstyp etc.).

•	Anzahl paralleler Jobs:

•	1 Job (z.B. nur Minijob oder nur Werkstudent).

•	Mehrere Jobs (z.B. KFB + Teilzeit, Werkstudent + Minijob).

•	Für jeden Job:

•	Job-Typ (Shortlist mit Tax/Regel-Logik):

•	Kurzfristige Beschäftigung (KFB).

•	Minijob.

•	Teilzeit.

•	Vollzeit.

•	Werkstudent.

•	Arbeitgeber-Name (Freitext).

•	Startdatum (optional: geplantes Enddatum).

•	Standard-Stundenlohn (Pflicht für alle nicht-gehaltbasierten Jobs).

•	Beschäftigungsmodell:

•	Stundenbasiert (Standard für KFB, Minijob, Werkstudent, Teilzeit).

•	Fixgehalt (typisch Vollzeit/Teilzeit).

•	Optionen:

•	Provisionen aktiv (ja/nein).

•	Trinkgeld-Tracking aktiv (ja/nein).

•	Urlaubsanspruch/Urlaubstage (optional).

•	Krankentage-Regeln (optional, v.a. Tracking).

Jobtypen und Regel-Logik

Jeder Job-Typ hat eine hinterlegte Regelkonfiguration für 2026, die die App intern nutzt:

•	Minijob:

•	Monatliche Entgeltgrenze: 603 € Brutto (2026-Konfiguration).

•	App berechnet pro Kalendermonat das aufsummierte Minijob-Brutto und zeigt Fortschritt zum Limit (Progressbar + Ampelsystem).

•	Kurzfristige Beschäftigung (KFB):

•	Tracking von Anzahl Arbeitstage und/oder Wochen pro Jahr.

•	Parameterisierbar für 26‑Wochen‑Regel (z.B. „Werkstudent + Minijob maximal 26 Wochen im Jahr“).

•	Werkstudentenjob:

•	Kombination mit anderen Beschäftigungen (Minijob, KFB) relevant.

•	Regel: Überwachung der maximal zulässigen Wochen/Arbeitstage im Jahr, insbesondere in Kombination mit anderen Jobs (26‑Wochen‑Fenster).

•	Teilzeit/Vollzeit:

•	Fokus auf Stunden-/Tage-Tracking, Urlaub/Krankentage, Brutto/Netto-Projektionen.

Diese Regeln sind nicht hart ins UI eingebrannt, sondern in einer Konfiguration/Regel-Engine hinterlegt, damit spätere Anpassungen (neue Jahreswerte, Gesetzesänderungen) möglich sind.

Zeit- und Tage-Tracking

Kernfunktion ist die zeit- und tagesbasierte Erfassung der Arbeit pro Job:

•	Granularität:

•	Pro Tag ein oder mehrere Zeiteinträge: Datum, Stundenanzahl, optional abweichender Stundenlohn (falls z.B. Zuschläge).

•	Typische Eingabe: „Tag 1: 6 Stunden à 20 €“, „Tag 2: 8 Stunden à 20 €“.

•	Job-spezifische Defaults:

•	Vollzeit/Teilzeit mit Fixschema: Option, Standard-Arbeitstage und Standardstunden pro Tag zu definieren (z.B. Mo–Fr, 8h), damit sich Tage automatisiert generieren lassen und nur Ausnahmen angepasst werden.

•	Tage-Klassifizierung:

•	Arbeits-/Produktivtage.

•	Urlaubstage (bezahlt/unbezahlt, je nach Jobtyp).

•	Kranktage.

•	Nicht gearbeitete Werktage (für Statistik).

•	Auswertungen:

•	Pro Job: Monats- und Jahresübersicht (Anzahl Tage, Stunden, Durchschnittsstunden pro Tag).

•	Global: Aggregierte Ansicht über alle Jobs.

Einkommens-/Brutto-Netto-Engine

Die App soll Brutto und Netto für jeden Job und aggregiert berechnen, unter Berücksichtigung der Tages-/Stundenbuchungen.

•	Bruttoberechnung:

•	Stundenlohn * Stunden pro Tag, aufsummiert pro Monat/Jahr.

•	Fixgehalt pro Monat bei Vollzeit/Teilzeit, ggf. plus Überstunden, plus Provision.

•	Zusatzeinnahmen:

•	Provision:

•	Pro Tag, pro Monat oder pro Auftrag erfassbar.

•	Auf Wunsch Teil des Brutto (je nach Jobkonfiguration).

•	Trinkgeld:

•	Wird separat erfasst.

•	Gehört explizit nicht zum Brutto-Gehalt, soll aber im Netto-„Cashflow“ mitlaufen (eigene Kategorie, wird zum Netto addiert).

•	Brutto/Netto-Rechner:

•	Für jeden Job-Typ existiert ein Profil, das seine steuerliche Behandlung abbildet (z.B. Minijob pauschal, Werkstudent sozialversicherungsrechtliche Besonderheiten).

•	Auf Basis der Onboarding-Daten (Steuerklasse etc.) und der Monats-/Jahressummen wird eine Netto-Schätzung pro Job und insgesamt berechnet.

•	Möglichkeit, pro Job und global einen „Brutto/Netto-Report“ pro Monat/Jahr anzuzeigen.

Limit-Überwachung und Warnungen

Die App überwacht kontinuierlich relevante Schwellenwerte und zeigt frühzeitig Warnungen an.

•	Typische Limits:

•	Minijob: Monatslimit (603 €) und ggf. Jahresbetrachtung.

•	Kurzfristige Beschäftigung: Maximal zulässige Tage/Wochen pro Jahr.

•	Werkstudent: Kombination mit Minijob/KFB, maximale erlaubte Wochen (z.B. 26 Wochen-Regel im Jahr).

•	Logik:

•	Für jedes Limit existiert eine definierte Schwellen-Logik:

•	Info-Warnung bei z.B. 80% Auslastung.

•	„Kritische“ Warnung bei 95–100%.

•	Warnungen werden context-aware generiert:

•	„Wenn du nächsten Monat weiter wie bisher arbeitest, überschreitest du voraussichtlich die Minijob-Grenze.“

•	„Du hast bereits 24 von 26 zulässigen Wochen als Werkstudent mit Minijob-Kombination gearbeitet.“

•	UX:

•	Visuelle Indikatoren: Farbcodes, Progressbars.

•	Optional: Push-ähnliche Notifications innerhalb der Web-App (z.B. Banner/Toast beim Öffnen).

Krankheitstage und Urlaub

Krankheit und Urlaub sollen als eigener Status pro Tag erfasst werden.

•	Pro Job:

•	Markierung eines Tages als „Krank“ oder „Urlaub“ statt „Gearbeitet“.

•	Optionale Felder:

•	Ob Lohnfortzahlung stattfindet (relevant für Netto-Berechnung bei Vollzeit/Teilzeit/Werkstudent).

•	Notizen (z.B. Attest, Urlaubsort etc.).

•	Reports:

•	Anzahl Urlaubstage und Krankheitstage pro Jahr und pro Job.

•	Resturlaub bei konfiguriertem Jahresurlaub.

Datenmodell (High-Level)

Ein mögliches Domain-Modell (unabhängig von konkreter DB-Technologie):

•	User:

•	id, persönliche Steuer-/SV-Einstellungen, App-Einstellungen.

•	Job:

•	id, user_id, type (enum: KFB, Minijob, Teilzeit, Vollzeit, Werkstudent),

•	employer_name, start_date, end_date,

•	default_hourly_rate, salary_type (hourly/fixed), net_treatment_profile,

•	flags: has_commission, has_tip_tracking.

•	WorkDay:

•	id, job_id, date, status (worked/vacation/sick/other),

•	total_hours, hourly_rate_override, note.

•	EarningsExtra:

•	id, workday_id (oder job_id/monatlich),

•	type (commission/tip/other),

•	amount.

•	RuleSet/Config:

•	year, job_type, parameter_key (e.g. „minijob_monthly_cap“), value,

•	helper für Berechnungen (z.B. maximale Wochen/ Tage, Pauschalsteuersätze).

Diese Struktur ist erweiterbar, z.B. für neue Jobtypen oder zusätzliche Regelwerke.

UX-Flows

Wichtige Flows, die die App unterstützen muss:

•	Onboarding:

•	User erstellt Account, gibt Basisdaten ein, legt Jobs an.

•	Daily Tracking:

•	Direktnavigation zu „Heute“ bzw. „Tag auswählen“, Stunden erfassen, optional Provision/Trinkgeld hinzufügen.

•	Für Vollzeit/Teilzeit: Schneller „Standardtag bestätigen“-Button.

•	Monats-/Jahresübersicht:

•	Liste der Monate mit Kurzstatistiken (Stunden, Brutto, Netto, Limit-Auslastung).

•	Detailansicht mit Tagesliste und Summen.

•	Limit-Feedback:

•	Beim Buchen eines neuen Tages wird live angezeigt, wie sich das auf die relevanten Limits auswirkt (z.B. Fortschrittsanzeige für 603‑€‑Grenze im aktuellen Monat).

•	Settings:

•	Jahreswechsel (neue Regelkonfigurationen).

•	Anpassung der persönlichen Steuerdaten.

•	Aktivieren/Deaktivieren von Jobtypen, Bearbeiten bestehender Jobs.Das UI deiner Webapp soll sich visuell wie eine native iOS‑26‑„Liquid Glass“ Oberfläche anfühlen, also transluzente, dynamische Glass‑Layer über dem Content mit klarer Hierarchie und sehr cleanem, typografisch reduziertem Design. Technisch erreichst du das im Web vor allem über moderne CSS‑Effekte wie  backdrop-filter , halbtransparente Layer, Noise/Grain und abgestufte Schatten, ggf. kombiniert mit einer kleinen React/Tailwind‑Komponentenbibliothek.[github +8]

Zielbild Liquid-Glass-UI

Liquid Glass ist Apples neues Design‑Material ab iOS 26: transluzente Paneele, die Umgebung und Licht „brechen“, dynamisch auf Content, Theme und Motion reagieren und klar zwischen Navigation/Controls und eigentlichem Inhalt unterscheiden. Die Glass‑Layer liegen als eigenständige Funktionsschicht über dem Inhalt (Navigation, Toolbars, Sheets, Cards), während Listen, Tabellen und Formulare selbst nicht „verglast“ werden, um die Informationshierarchie deutlich zu halten.[apple +3]

Für deine Job‑Tracker‑Webapp heißt das: Job‑Cards, Bottom‑Navigation und Overlays sind semi‑transparente Glass‑Container, der Hauptcontent (Tagesliste, Tabellen, Formulare) bleibt weitgehend „solid“ mit klarem Hintergrund und hoher Lesbarkeit.

Design-Prinzipien für dein Layout

•	Navigationsebene als Liquid Glass: Bottom‑Tabbar, Header, Floating Action Buttons und modale Overlays bekommen den Liquid‑Glass‑Look; sie „schweben“ visuell über dem restlichen UI.[wikipedia +2]

•	Contentebene bleibt ruhig: Tabellen, Inputs und Textbereiche nutzen eher neutrale Hintergründe (z.B. leicht getönte Flächen), damit die Glass‑Layer nicht mit dem Content konkurrieren und die Steuer‑Infos/Warnings gut lesbar bleiben.[developer.apple +1]

•	Depth & Hierarchie: Du arbeitest mit mehreren Ebenen: Hintergrund (z.B. dezentes Gradient oder Wallpaper), darauf Content‑Cards, darüber Liquid‑Glass‑Navigation/Overlays mit Blur, Glow und subtilen Kanten, jeweils mit abgestuften Schatten und Z‑Indizes.[github +2]

•	Adaptivität: Farben der Glass‑Layer sollten von deinem Theme bzw. Background abgeleitet werden (hell/dunkel, Akzentfarbe), ähnlich wie Liquid Glass seine Farbe aus dem Umgebungskontext nimmt.[github +2]

Technische Umsetzung in CSS

Im Web approximierst du Liquid Glass mit einer Kombination aus Blur, Transparenz, Tints, Borders, Schatten und optional Noise‑Textures.[dev +4]Auf Code‑Ebene ist es sinnvoll, eine kleine Design‑System‑Schicht für Liquid‑Glass‑Komponenten zu bauen oder eine bestehende Bibliothek zu verwenden.[developer.apple +1]

•	Abstrakte „Material“-Komponente:  

Eine  GlassSurface ‑Komponente (z.B. React/Tailwind) kapselt alle CSS‑Details (Blur, Tints, Noise, Shadows) und bietet Props wie  variant="regular | clear | tinted" ,  elevation ,  interactive .[github +1]

•	Verwendung im Job‑Tracker:

•	 GlassNavBar  für Tabbar/Topbar.

•	 GlassCard  für Job‑Übersicht (Minijob, Werkstudent, KFB etc.).

•	 GlassSheet  für modale Dialoge wie „Neuen Arbeitstag eintragen“, „Warning: Limit fast erreicht“.

•	Tailwind/Utility‑First Ansatz:  

Wenn du Tailwind nutzt, kannst du die Liquid‑Glass‑Styles als  @apply ‑Utilities kapseln (z.B.  .glass-base ,  .glass-strong ) oder eine Bibliothek wie  apple-web-liquid-glass  integrieren, die fertige React‑Komponenten im iOS‑26‑Stil liefert.[github]

Durch diese Kapselung kannst du später das visuelle Tuning (Blur‑Stärke, Noise, Tints) zentral anpassen, ohne Business‑Logik oder Formular‑Code anzufassen.

Performance und Fallbacks

•	Performance auf iOS: Mehrere  backdrop-filter ‑Layer sind GPU‑intensiv, v.a. auf älteren Geräten; begrenze also die Anzahl gleichzeitig sichtbarer Glass‑Flächen und reduziere Blur‑Radius bei großen Fullscreen‑Overlays.[css-tricks +2]

•	Fallbacks: Über  @supports (backdrop-filter: blur(1px))  kannst du für Browser ohne Support (ältere Android‑Browser, Desktop) auf einfache semi‑transparente Hintergründe ohne Blur zurückfallen.[web +1]

•	Accessibility: Achte auf ausreichend Kontrast, da Blur + Transparenz leicht die Lesbarkeit reduziert; optional kannst du eine „Kontrastmodus“‑Option anbieten, die Glass‑Effekte reduziert oder deaktiviert, analog zu iOS’ „Transparenz reduzieren“ Feature.