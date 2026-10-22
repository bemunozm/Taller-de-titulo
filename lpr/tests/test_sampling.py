from lpr.utils.sampling import FrameScheduler


def _count(fps, interval, seconds=10.0, sched=None, start=0.0):
    sched = sched or FrameScheduler(interval)
    n, i = 0, 0
    while True:
        t = start + i / fps
        if t > start + seconds:
            return n
        if sched.due(t):
            n += 1
        i += 1


def test_15fps_stream_gets_target_rate():
    assert 79 <= _count(15, 1 / 8) <= 81


def test_25fps_stream_gets_target_rate():
    assert 79 <= _count(25, 1 / 8) <= 81


def test_jittered_15fps_stream():
    sched = FrameScheduler(1 / 8)
    n = 0
    t = 0.0
    for i in range(150):
        t = i / 15 + (0.004 if i % 2 else -0.0)
        if sched.due(t):
            n += 1
    assert 78 <= n <= 81


def test_slow_stream_takes_every_frame():
    sched = FrameScheduler(1 / 8)
    assert all(sched.due(i / 6) for i in range(60))


def test_no_burst_after_stall():
    sched = FrameScheduler(1 / 8)
    for i in range(30):
        sched.due(i / 6)
    t = 30 / 6 + 2.0  # 2 s gap
    assert sched.due(t) is True
    # the next frames (every 1/15 s) must not all be accepted
    taken = sum(sched.due(t + (k + 1) / 15) for k in range(15))
    assert 7 <= taken <= 9


def test_runtime_interval_change():
    sched = FrameScheduler(1 / 8)
    first = _count(15, 1 / 8, 5.0, sched)
    assert 39 <= first <= 41
    sched2 = FrameScheduler(1 / 8)
    n = 0
    for i in range(150):
        if sched2.due(i / 15, interval=1 / 8 if i < 75 else 1 / 2):
            n += 1
    assert 48 <= n <= 52  # ~40 in the first 5 s (8 fps), ~10 in the last 5 s (2 fps)


def test_invalid_interval():
    import pytest
    with pytest.raises(ValueError):
        FrameScheduler(0)
