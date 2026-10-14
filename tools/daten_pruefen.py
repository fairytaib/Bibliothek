#!/usr/bin/env python3
"""
Prüft data.json und tags.json auf Fehler, bevor die Seite veröffentlicht wird.

Aufruf (im Hauptordner der Seite):   python3 tools/daten_pruefen.py
Auf GitHub läuft das automatisch bei jedem Hochladen (siehe .github/workflows).

Fehler   → die Seite wird NICHT veröffentlicht (Exit-Code 1).
Hinweise → die Seite wird veröffentlicht, die Hinweise stehen im Protokoll.
"""
import json
import os
import re
import sys
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ON_GITHUB = os.environ.get("GITHUB_ACTIONS") == "true"

errors = []
warnings = []


def fehler(datei, text):
    errors.append((datei, text))


def hinweis(datei, text):
    warnings.append((datei, text))


def lade(name):
    pfad = os.path.join(ROOT, name)
    try:
        with open(pfad, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        fehler(name, "Datei fehlt.")
    except json.JSONDecodeError as e:
        fehler(name, f"Ungültiges JSON in Zeile {e.lineno}, Spalte {e.colno}: {e.msg}. "
                     "Häufige Ursache: ein Komma zu viel oder zu wenig.")
    return None


def url_schluessel(url):
    """Gleicher Link trotz unterschiedlicher Schreibweise (youtu.be vs. watch?v=, Tracking-Parameter)."""
    try:
        u = urlparse(url.strip())
        host = re.sub(r"^(www\.|m\.)", "", u.netloc.lower())
        q = parse_qs(u.query)
        if host == "youtu.be":
            return "yt:v:" + u.path.lstrip("/")
        if host == "youtube.com":
            if "v" in q:
                return "yt:v:" + q["v"][0]
            m = re.match(r"^/(live|shorts)/([^/]+)", u.path)
            if m:
                return "yt:v:" + m.group(2)
            if "list" in q:
                return "yt:list:" + q["list"][0]
        return (host + u.path + ("?" + u.query if u.query else "")).lower()
    except Exception:
        return url.strip().lower()


def pruefe_tags(tags):
    """Gibt (alle Tags → Gruppe, Themen-Tags, Sprachen) zurück."""
    info, themen, sprachen = {}, set(), []
    if tags is None:
        return info, themen, sprachen
    if not isinstance(tags, dict):
        fehler("tags.json", 'Erwartet ein Objekt mit "sprachen" und "gruppen".')
        return info, themen, sprachen

    sprachen = tags.get("sprachen", [])
    if not isinstance(sprachen, list) or not all(isinstance(s, str) and s.strip() for s in sprachen):
        fehler("tags.json", '"sprachen" muss eine Liste von Texten sein.')
        sprachen = []

    gruppen = tags.get("gruppen")
    if not isinstance(gruppen, list) or not gruppen:
        fehler("tags.json", '"gruppen" fehlt oder ist leer.')
        return info, themen, sprachen

    ids = set()
    for i, g in enumerate(gruppen, 1):
        if not isinstance(g, dict):
            fehler("tags.json", f"Gruppe {i} ist kein Objekt.")
            continue
        name = g.get("name") or f"Gruppe {i}"
        if g.get("id") in ids:
            fehler("tags.json", f'Gruppen-ID "{g.get("id")}" kommt doppelt vor.')
        ids.add(g.get("id"))
        if g.get("art") not in ("thema", "filter"):
            fehler("tags.json", f'{name}: "art" muss "thema" oder "filter" sein.')
        if g.get("art") == "filter" and g.get("regel") not in ("genau-eins", "hoechstens-eins", "optional"):
            fehler("tags.json", f'{name}: "regel" muss "genau-eins", "hoechstens-eins" oder "optional" sein.')
        for t in g.get("tags", []):
            tag = t.get("name") if isinstance(t, dict) else None
            if not isinstance(tag, str) or not tag.strip():
                fehler("tags.json", f"{name}: Ein Tag hat keinen Namen.")
                continue
            if tag.lower() in {k.lower() for k in info}:
                fehler("tags.json", f'Tag "{tag}" ist doppelt definiert.')
                continue
            if not (isinstance(t, dict) and str(t.get("beschreibung", "")).strip()):
                hinweis("tags.json", f'Tag "{tag}" hat keine Beschreibung.')
            info[tag] = g
            if g.get("art") == "thema":
                themen.add(tag)
    return info, themen, sprachen


def pruefe_daten(daten, info, themen, sprachen):
    if daten is None:
        return
    if not isinstance(daten, list):
        fehler("data.json", "Erwartet eine Liste [ … ] von Gelehrten.")
        return

    erlaubte_spez = themen | {"Allrounder", ""}
    gesehene_ids = set()
    urls = {}

    for i, p in enumerate(daten, 1):
        if not isinstance(p, dict):
            fehler("data.json", f"Eintrag {i} ist kein Objekt (oft ein Komma zu viel).")
            continue
        name = p.get("name") or f"Eintrag {i}"
        wo = f"{name}"

        pid = p.get("id")
        if not isinstance(pid, str) or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", pid or ""):
            fehler("data.json", f'{wo}: ID "{pid}" ist ungültig (nur Kleinbuchstaben, Ziffern, Bindestriche).')
        elif pid in gesehene_ids:
            fehler("data.json", f'{wo}: ID "{pid}" kommt doppelt vor.')
        gesehene_ids.add(pid)

        if not str(p.get("name", "")).strip():
            fehler("data.json", f"Eintrag {i}: Name fehlt.")
        for feld in ("sprache", "spezialisierung", "anmerkung"):
            if feld in p and not isinstance(p[feld], str):
                fehler("data.json", f'{wo}: "{feld}" muss ein Text sein.')
        if sprachen and p.get("sprache") and p["sprache"] not in sprachen:
            hinweis("data.json", f'{wo}: Sprache "{p["sprache"]}" steht nicht in tags.json.')
        if themen and p.get("spezialisierung", "") not in erlaubte_spez:
            hinweis("data.json", f'{wo}: Spezialisierung "{p.get("spezialisierung")}" ist weder "Allrounder" noch ein Thema aus tags.json.')

        for liste, art in (("videos", "Video"), ("buecher", "Buch")):
            eintraege = p.get(liste, [])
            if not isinstance(eintraege, list):
                fehler("data.json", f'{wo}: "{liste}" muss eine Liste sein.')
                continue
            for j, r in enumerate(eintraege, 1):
                ort = f"{wo}, {art} {j}"
                if not isinstance(r, dict):
                    fehler("data.json", f"{ort}: kein Objekt (oft ein Komma zu viel).")
                    continue
                titel = r.get("titel")
                if not isinstance(titel, str) or not titel.strip():
                    fehler("data.json", f"{ort}: Titel fehlt.")
                else:
                    ort = f'{wo}, {art} „{titel}“'
                url = r.get("url")
                if not isinstance(url, str) or not re.match(r"^https?://\S+$", url):
                    fehler("data.json", f"{ort}: URL fehlt oder beginnt nicht mit http(s)://.")
                else:
                    key = url_schluessel(url)
                    if key in urls:
                        hinweis("data.json", f"{ort}: gleicher Link wie bei {urls[key]}.")
                    else:
                        urls[key] = ort
                if "beschreibung" in r:
                    if not isinstance(r["beschreibung"], str):
                        fehler("data.json", f'{ort}: "beschreibung" muss ein Text sein.')
                    elif len(r["beschreibung"]) > 300:
                        hinweis("data.json", f"{ort}: Beschreibung ist sehr lang ({len(r['beschreibung'])} Zeichen).")
                if "sprache" in r and sprachen and r["sprache"] not in sprachen:
                    hinweis("data.json", f'{ort}: Sprache "{r["sprache"]}" steht nicht in tags.json.')

                tags = r.get("themen", [])
                if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
                    fehler("data.json", f'{ort}: "themen" muss eine Liste von Texten sein.')
                    continue
                if info:
                    for t in tags:
                        if t not in info:
                            fehler("data.json", f'{ort}: Tag "{t}" gibt es nicht in tags.json (Tippfehler?).')
                    gruppen = [info[t].get("id") for t in tags if t in info]
                    if liste == "videos" and gruppen.count("format") != 1:
                        hinweis("data.json", f"{ort}: genau ein Format-Tag (Playlist oder Einzelvideo) erwartet.")
                    if liste == "buecher" and "format" in gruppen:
                        hinweis("data.json", f"{ort}: Bücher brauchen keinen Format-Tag.")
                    if gruppen.count("niveau") > 1:
                        hinweis("data.json", f"{ort}: mehr als ein Niveau-Tag.")
                    if not any(info[t].get("art") == "thema" for t in tags if t in info):
                        hinweis("data.json", f"{ort}: kein inhaltliches Thema getaggt.")
                if len(tags) != len(set(tags)):
                    hinweis("data.json", f"{ort}: ein Tag ist doppelt eingetragen.")


def ausgeben():
    for datei, text in errors:
        print(f"::error file={datei}::{text}" if ON_GITHUB else f"FEHLER  {datei}: {text}")
    for datei, text in warnings:
        print(f"::warning file={datei}::{text}" if ON_GITHUB else f"Hinweis {datei}: {text}")
    print()
    if errors:
        print(f"✗ {len(errors)} Fehler, {len(warnings)} Hinweis(e). Die Seite wird nicht veröffentlicht.")
    else:
        print(f"✓ Keine Fehler, {len(warnings)} Hinweis(e). Die Daten sind in Ordnung.")


if __name__ == "__main__":
    tags_info, themen_tags, sprachen_liste = pruefe_tags(lade("tags.json"))
    pruefe_daten(lade("data.json"), tags_info, themen_tags, sprachen_liste)
    ausgeben()
    sys.exit(1 if errors else 0)
