"""Replay del Guardián (`tools/guardian_replay.py`): puntaje puro, verdad terreno y
un recorrido completo sobre un clip sintético con un modelo falso (sin GPU)."""
import json
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from lpr.processor.guardian_rules import GuardianRules, LegacyRules
from lpr.tools import guardian_replay as gr
from lpr.tools.guardian_replay import Alert, GtRow

SQUARE = [{'x': 0.4, 'y': 0.4}, {'x': 0.6, 'y': 0.4}, {'x': 0.6, 'y': 0.6}, {'x': 0.4, 'y': 0.6}]


def row(clip='c1', t0=10, t1=30, event='intrusion', people=1):
    return GtRow(clip=clip, t0=t0, t1=t1, event=event, people=people)


def alert(t, kind='intrusion', clip='c1', tid=1):
    return Alert(clip=clip, t=t, type=kind, track_id=tid)


# ----------------------------------------------------------------------------
# Puntaje
# ----------------------------------------------------------------------------
def test_hit_missed_and_false_alarm():
    gt = [row('c1', 10, 30), row('c2', 10, 30, 'loitering')]
    sc = gr.score([alert(12), alert(99, clip='c1')], gt)
    assert (sc.n_events, sc.hits, sc.missed, sc.false_alarms, sc.duplicates) == (2, 1, 1, 1, 0)
    assert sc.missed_by_type == {'loitering': 1} and sc.hits_by_type == {'intrusion': 1}
    assert sc.latencies == [2.0]


def test_alert_of_another_type_is_a_false_alarm_and_the_event_is_missed():
    sc = gr.score([alert(15, 'loitering')], [row(event='intrusion')])
    assert (sc.hits, sc.missed, sc.false_alarms) == (0, 1, 1)


def test_alert_inside_a_ninguno_window_is_a_false_alarm():
    sc = gr.score([alert(15)], [row(event='ninguno')])
    assert (sc.n_events, sc.false_alarms) == (0, 1)


def test_clean_clip_without_alerts_scores_nothing_wrong():
    sc = gr.score([], [row(event='ninguno')])
    assert (sc.n_events, sc.missed, sc.false_alarms, sc.alerts_total) == (0, 0, 0, 0)


def test_duplicates_are_alerts_above_the_number_of_people():
    gt = [row(people=1), row('c2', people=2)]
    alerts = [alert(11), alert(15, tid=2), alert(20, tid=3),            # 3 alertas, 1 persona
              alert(11, clip='c2'), alert(12, clip='c2', tid=2)]         # 2 alertas, 2 personas
    sc = gr.score(alerts, gt)
    assert sc.hits == 2 and sc.duplicates == 2 and sc.false_alarms == 0
    assert len(sc.duplicate_detail) == 1


def test_margin_extends_the_window_on_both_sides():
    gt = [row(t0=10, t1=20)]
    assert gr.score([alert(8.5)], gt, margin=2.0).hits == 1
    assert gr.score([alert(22.5)], gt, margin=2.0).false_alarms == 1
    assert gr.score([alert(8.5)], gt, margin=1.0).false_alarms == 1


def test_clip_must_match():
    sc = gr.score([alert(15, clip='otro')], [row('c1')])
    assert (sc.hits, sc.false_alarms, sc.missed) == (0, 1, 1)


def test_latency_is_the_first_alert_minus_start():
    sc = gr.score([alert(18), alert(14, tid=2)], [row(t0=10, t1=30, people=2)])
    assert sc.latencies == [4.0]


def test_overlapping_rows_attribute_to_the_nearest_center():
    gt = [row(t0=0, t1=20), row(t0=15, t1=60)]
    sc = gr.score([alert(40)], gt)
    assert sc.hits == 1 and sc.missed == 1


# ----------------------------------------------------------------------------
# Verdad terreno y zonas
# ----------------------------------------------------------------------------
def test_load_gt(tmp_path: Path):
    f = tmp_path / 'gt.csv'
    f.write_text('clip,t_inicio_s,t_fin_s,evento,zona,personas\n'
                 'a1,5,25.5,intrusion,0,2\n'
                 'a2,0,60,ninguno,,\n'
                 'a3,3,40,LOITERING,1,x\n', encoding='utf-8')
    rows = gr.load_gt(f)
    assert [(r.clip, r.t0, r.t1, r.event, r.people) for r in rows] == [
        ('a1', 5.0, 25.5, 'intrusion', 2), ('a2', 0.0, 60.0, 'ninguno', 1), ('a3', 3.0, 40.0, 'loitering', 1)]


@pytest.mark.parametrize('content, message', [
    ('clip,t_inicio_s,t_fin_s,evento\na,1,2,robo\n', 'no válido'),
    ('clip,t_inicio_s,t_fin_s,evento\na,5,2,intrusion\n', 't_fin_s < t_inicio_s'),
])
def test_load_gt_rejects_bad_rows(tmp_path: Path, content, message):
    f = tmp_path / 'gt.csv'
    f.write_text(content, encoding='utf-8')
    with pytest.raises(ValueError, match=message):
        gr.load_gt(f)


def test_load_zones_accepts_legacy_list_new_list_and_backend_response(tmp_path: Path):
    legacy = tmp_path / 'legacy.json'
    legacy.write_text(json.dumps([SQUARE]), encoding='utf-8')
    new = tmp_path / 'new.json'
    new.write_text(json.dumps({'id': 'x', 'enableGuardian': True,
                               'guardianZones': [{'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 15}]}),
                   encoding='utf-8')
    assert [z.type for z in gr.load_zones(str(legacy))[0]] == ['intrusion']
    zones = gr.load_zones(str(new))[0]
    assert [(z.type, z.loiter_seconds) for z in zones] == [('loitering', 15.0)]
    assert gr.load_zones(None)[0] == []


def test_build_rules_selects_the_engine():
    assert isinstance(gr.build_rules('current', []), GuardianRules)
    assert isinstance(gr.build_rules('legacy', []), LegacyRules)


def test_find_clips_filters_by_extension_and_name(tmp_path: Path):
    for name in ('a-1.mkv', 'b-2.mp4', 'c.txt', 'a-3.avi'):
        (tmp_path / name).write_bytes(b'')
    assert [p.name for p in gr.find_clips(tmp_path)] == ['a-1.mkv', 'a-3.avi', 'b-2.mp4']
    assert [p.name for p in gr.find_clips(tmp_path, only='a-')] == ['a-1.mkv', 'a-3.avi']


# ----------------------------------------------------------------------------
# Replay completo con modelo falso sobre un clip sintético
# ----------------------------------------------------------------------------
class FakeBoxes:
    def __init__(self, items):
        self.items = items

    def __len__(self):
        return len(self.items)

    def __iter__(self):
        return iter(self.items)


class FakeModel:
    """Una persona quieta dentro de la zona, siempre con el mismo id."""

    def __init__(self, tid=1, bbox=(480.0, 420.0, 520.0, 580.0)):
        self.tid, self.bbox, self.calls = tid, bbox, 0

    def track(self, frame, **kwargs):
        self.calls += 1
        box = SimpleNamespace(id=SimpleNamespace(item=lambda: self.tid), xyxy=np.array([list(self.bbox)]),
                              conf=SimpleNamespace(item=lambda: 0.8))
        return [SimpleNamespace(boxes=FakeBoxes([box]))]


@pytest.fixture
def clip(tmp_path: Path) -> Path:
    path = tmp_path / 'cam-20261022-c1.avi'
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'MJPG'), 4.0, (320, 240))
    if not writer.isOpened():
        pytest.skip('OpenCV sin codificador MJPG')
    rng = np.random.default_rng(0)
    for _ in range(4 * 30):  # 30 s a 4 fps
        writer.write(rng.integers(0, 255, (240, 320, 3), dtype=np.uint8))
    writer.release()
    return path


def test_replay_clip_current_rules_report_each_event_once(clip):
    stats = gr.ReplayStats()
    zones = gr.parse_guardian_zones([{'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 8}, SQUARE])
    # El frame sintético es 320x240; la caja del modelo falso está en píxeles de 1000x1000,
    # así que se escala para que caiga dentro de las zonas.
    model = FakeModel(bbox=(150.0, 100.0, 170.0, 140.0))
    alerts = gr.replay_clip(clip, 'c1', model, fps=1.0, rules_kind='current', zones=zones,
                            imgsz=960, device=None, retention=None, stats=stats)
    kinds = sorted(a.type for a in alerts)
    # 30 s de la misma persona: merodeo una vez (60 s) e intrusión a los 2 s y a los 22 s (zona 20 s)
    assert kinds == ['intrusion', 'intrusion', 'loitering']
    assert stats.frames >= 28 and stats.inferences == len(stats.inference_ms) and stats.inferences > 0
    gt = [GtRow('c1', 0, 30, 'intrusion', people=2), GtRow('c1', 0, 30, 'loitering')]
    sc = gr.score(alerts, gt)
    assert (sc.hits, sc.missed, sc.false_alarms, sc.duplicates) == (2, 0, 0, 0)


def test_replay_clip_legacy_rules_ignore_zone_types(clip):
    stats = gr.ReplayStats()
    zones = gr.parse_guardian_zones([{'points': SQUARE, 'type': 'loitering', 'loiterSeconds': 8}])
    alerts = gr.replay_clip(clip, 'c1', FakeModel(bbox=(150.0, 100.0, 170.0, 140.0)), fps=1.0,
                            rules_kind='legacy', zones=zones, imgsz=960, device=None, retention=None, stats=stats)
    # Con las reglas viejas la zona de merodeo es una zona de INTRUSIÓN.
    assert {a.type for a in alerts} == {'intrusion'}


def test_replay_clip_without_retention_runs_fewer_inferences(clip):
    s_ret, s_none = gr.ReplayStats(), gr.ReplayStats()
    kw = dict(fps=1.0, rules_kind='current', zones=[], imgsz=960, device=None)
    gr.replay_clip(clip, 'c1', FakeModel(), retention=10.0, stats=s_ret, **kw)
    gr.replay_clip(clip, 'c1', FakeModel(), retention=0.0, stats=s_none, **kw)
    # El ruido aleatorio mueve MOG2 en ambos; con retención nunca corre MENOS.
    assert s_ret.inferences >= s_none.inferences


def test_format_report_lists_the_key_numbers():
    sc = gr.score([alert(12), alert(15, tid=2), alert(80)], [row(), row('c2', event='loitering')])
    stats = gr.ReplayStats(frames=100, inferences=40, inference_ms=[10.0, 20.0])
    args = SimpleNamespace(rules='current', fps=1.0, imgsz=960)
    text = gr.format_report('despues', args, sc, stats, 'cuda:0', 2, 1)
    for needle in ('despues', 'reglas=current', 'aciertos=1', 'omitidos=1', 'FALSAS_ALARMAS=1', 'duplicadas=1',
                   'cuda:0', '15.0 ms/inferencia', '40/100', 'latencia'):
        assert needle in text, needle
