"""Pure data model: completed matches are the sole source of statistics."""
from copy import deepcopy
from datetime import datetime, timezone
import re
import math
import uuid


def empty_data():
    return {"profiles": [], "matches": [], "settings": {"soundVolume": .7}, "pair_resets": {}, "seen": []}


def name_key(name):
    return str(name).strip().casefold()


def pair_key(a, b):
    return '|'.join(sorted([a, b]))


def ensure_profiles(data, names):
    result = []
    for name in names:
        name = str(name).strip()[:40]
        if not name:
            raise ValueError('Ein Spielername fehlt.')
        p = next((p for p in data['profiles'] if name_key(p['name']) == name_key(name)), None)
        if not p:
            p = {'id': uuid.uuid4().hex, 'name': name}
            data['profiles'].append(p)
        result.append(p)
    if len({p['id'] for p in result}) != len(result):
        raise ValueError('Bitte unterschiedliche Spielernamen verwenden.')
    return result


def bounded(value, maximum=100000000):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > maximum:
        raise ValueError('Ungültige Statistikdaten.')
    return value


def put_match(data, raw):
    match_id = str(raw.get('id', ''))
    if not re.fullmatch(r'[a-zA-Z0-9_-]{8,100}', match_id):
        raise ValueError('Ungültige Match-ID.')
    # Keep tombstones after resets/deletions so reconnecting tablets cannot re-add old games.
    if match_id in data['seen']:
        return
    players = raw.get('players', [])
    if raw.get('phase') != 'finished' or not 1 <= len(players) <= 4:
        raise ValueError('Nur abgeschlossene Matches können gespeichert werden.')
    winner = raw.get('winner')
    if type(winner) is not int or not 0 <= winner < len(players):
        raise ValueError('Das Match hat keinen gültigen Sieger.')
    profiles = ensure_profiles(data, [p.get('name', '') for p in players])
    clean = []
    for p, profile in zip(players, profiles):
        q = {'id': profile['id'], 'name': profile['name']}
        for field in ['points', 'darts', 'legs', 'sets', 'hundreds', 'oneforties', 'oneeighties', 'highestCheckout', 'bestLeg']:
            q[field] = bounded(p.get(field, 0))
        clean.append(q)
    needed = raw.get('needed', 1)
    if type(needed) is not int or not 1 <= needed <= 99:
        raise ValueError('Ungültiges Matchformat.')
    unit = 'sets' if raw.get('setsMode') else 'legs'
    if clean[winner][unit] < needed or any(p[unit] >= needed for i, p in enumerate(clean) if i != winner):
        raise ValueError('Das Match ist nicht vollständig abgeschlossen.')
    data['matches'].append({'id': match_id, 'date': datetime.now(timezone.utc).isoformat(),
                            'winner': profiles[winner]['id'], 'players': clean,
                            'startScore': int(bounded(raw.get('startScore', 501), 10001)),
                            'setsMode': bool(raw.get('setsMode')), 'needed': needed})
    data['seen'].append(match_id)


def mutate(data, action, payload):
    """Apply one atomic mutation on a copy; rejected requests leave data intact."""
    data = deepcopy(data)
    if action == 'finish_import':
        data['legacy_imported'] = True
    elif action == 'profiles':
        names = payload.get('names', [])
        if not 1 <= len(names) <= 4:
            raise ValueError('Ein bis vier Namen erforderlich.')
        ensure_profiles(data, names)
    elif action in ('match', 'match_state'):
        if action == 'match_state' and payload.get('phase') != 'finished':
            mid = payload.get('id')
            exists = any(m['id'] == mid for m in data['matches'])
            if exists:
                data['matches'] = [m for m in data['matches'] if m['id'] != mid]
                data['seen'] = [x for x in data['seen'] if x != mid]
        else:
            put_match(data, payload)
    elif action == 'settings':
        patch = payload.get('patch', {})
        for key, value in patch.items():
            if key == 'startScript':
                if value and not re.fullmatch(r'script\.[a-z0-9_]+', value):
                    raise ValueError('Bitte ein HA-Script auswählen.')
            elif key in ('soundVolume', 'callerVolume'):
                bounded(value, 1)
            elif key == 'callerVoice':
                if not isinstance(value, str) or len(value) > 120 or any(c in value for c in ('/', '\\', '\x00')) or value in ('.', '..'):
                    raise ValueError('Ungültiger Sprecherordner.')
            elif key in ('legSound', 'matchSound', 'setSound', 'introSound'):
                if value and not (re.fullmatch(r'/local/darts/audio/sounds/[^/\\\s]+', value) or (key in ('legSound', 'matchSound') and re.fullmatch(r'/local/dart-assistant/[a-z0-9_.-]+', value))):
                    raise ValueError('Ungültige Audiodatei.')
            elif key == 'logo':
                if value and not re.fullmatch(r'/local/dart-assistant/[a-z0-9_.-]+', value):
                    raise ValueError('Ungültige Mediendatei.')
            else:
                raise ValueError('Unbekannte Einstellung.')
            data['settings'][key] = value
    elif action in ('reset_player', 'delete_player'):
        if payload.get('confirm') != action:
            raise ValueError('Sicherheitsbestätigung fehlt.')
        pid = payload.get('player')
        if not any(p['id'] == pid for p in data['profiles']):
            raise ValueError('Spieler nicht gefunden.')
        data['matches'] = [m for m in data['matches'] if all(p['id'] != pid for p in m['players'])]
        data['pair_resets'] = {k: v for k, v in data['pair_resets'].items() if pid not in k.split('|')}
        if action == 'delete_player':
            data['profiles'] = [p for p in data['profiles'] if p['id'] != pid]
    elif action == 'reset_pair':
        if payload.get('confirm') != action:
            raise ValueError('Sicherheitsbestätigung fehlt.')
        a, b = payload.get('player'), payload.get('opponent')
        ids = {p['id'] for p in data['profiles']}
        if a == b or a not in ids or b not in ids:
            raise ValueError('Ungültige Paarung.')
        # Only this duel is reset; all-time records remain unchanged.
        data['pair_resets'][pair_key(a, b)] = datetime.now(timezone.utc).isoformat()
    else:
        raise ValueError('Unbekannte Aktion.')
    return data

