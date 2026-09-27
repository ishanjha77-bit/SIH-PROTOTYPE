"""Real-data checks: ISD parsing and each classification rule, on small synthetic networks (no network access)."""
from datetime import datetime, timedelta

from app.realdata import qc
from app.realdata.isd import Obs, Station, parse_row

T0 = datetime(2023, 4, 1)
STEP = timedelta(hours=3)
POS = {"a": (18.5, 73.8), "b": (18.6, 73.9), "c": (18.4, 73.7), "d": (18.55, 73.95), "e": (18.45, 73.85)}


def network(days: int = 12) -> dict[str, Station]:
    """Five nearby stations with an identical, smooth diurnal cycle (enough days for the climatology)."""
    net = {}
    for k, (lat, lon) in POS.items():
        st = Station(key=k, sid=k, name=k.upper(), lat=lat, lon=lon, elev=500)
        for n in range(days * 8):
            t = T0 + n * STEP
            T = 25 + 5 * ((t.hour - 9) % 24 < 12) + 0.1 * (n % 3)
            st.obs[t] = Obs(t=t, T=T, Td=T - 8, report="FM-12")
        net[k] = st
    return net


def test_parse_row_reads_synop_fields():
    row = {"DATE": "2023-04-06T12:00:00", "TMP": "+0158,2", "DEW": "+0158,1", "SLP": "10050,1",
           "WND": "270,1,N,0021,1", "AA1": "09,0100,3,1", "MW1": "95,1", "GA1": "07,1,+00250,1,09,1", "REPORT_TYPE": "FM-12"}
    o = parse_row(row)
    assert o and o.T == 15.8 and o.qT == "2" and o.Td == 15.8 and o.slp == 1005.0
    assert o.wind == 2.1 and o.rain == 10.0 and o.rain_h == 9 and o.ww == 95 and o.cb


def test_parse_row_skips_off_grid_and_missing():
    assert parse_row({"DATE": "2023-04-06T12:30:00", "TMP": "+0200,1"}) is None
    o = parse_row({"DATE": "2023-04-06T12:00:00", "TMP": "+9999,9"})
    assert o is not None and o.T is None


def test_weighted_median_resists_one_extreme_neighbour():
    assert qc.wmedian([(0.2, 1), (0.1, 1), (-10.0, 1), (0.3, 1), (0.0, 1)]) in (0.1, 0.2)


def test_clean_network_is_all_valid():
    v = qc.run(network())
    assert all(x.cls == "OK" for s in v.values() for x in s.values())


def test_dew_point_above_temperature_is_physics():
    net = network()
    t = T0 + 50 * STEP
    net["a"].obs[t].Td = net["a"].obs[t].T + 3
    assert qc.run(net)["a"][t].cls == "PHYSICS"


def test_sudden_jump_without_weather_is_spike():
    net = network()
    t = T0 + 60 * STEP
    net["a"].obs[t].T -= 12
    net["a"].obs[t].Td = net["a"].obs[t].T - 2  # only the temperature channel is wrong; keep the dew point plausible
    v = qc.run(net)["a"][t]
    assert v.cls == "SPIKE" and v.z is not None and v.z < -qc.Z_OUTLIER


def test_cold_outlier_with_neighbour_thunderstorm_is_real_weather():
    net = network()
    t = T0 + 60 * STEP
    net["a"].obs[t].T -= 12
    net["a"].obs[t].Td = net["a"].obs[t].T - 0.5  # storm outflow: cold and near saturation
    net["b"].obs[t].ww = 95  # thunderstorm reported at a neighbour
    v = qc.run(net)["a"][t]
    assert v.cls == "WEATHER" and any("thunderstorm" in e for e in v.evidence)


def test_frozen_reading_while_neighbours_move_is_stuck():
    net = network()
    start = 40
    frozen = net["a"].obs[T0 + start * STEP].T
    for n in range(start, start + 8):
        net["a"].obs[T0 + n * STEP].T = frozen
    v = qc.run(net)["a"]
    assert v[T0 + (start + 7) * STEP].cls == "STUCK"
    assert v[T0 + (start + 2) * STEP].cls != "STUCK"  # needs 18 h of evidence first


def test_real_stgnn_never_sees_the_station_it_predicts():
    """Changing a station's own reading must not change its own prediction (no leakage), only its neighbours'."""
    import torch
    from app.realdata.gnn_real import RealSTGNN, graph

    net = network(days=1)
    keys = list(net)
    static, edge = graph(net, keys)
    torch.manual_seed(0)
    model = RealSTGNN(static, edge).eval()
    B, N = 1, len(keys)
    x = torch.randn(B, N, 2); prev = torch.randn(B, N, 2); m = torch.ones(B, N, 2); tf = torch.randn(B, 4)
    base = model(x, prev, m, tf)
    x2 = x.clone(); x2[0, 0] += 25.0; prev2 = prev.clone(); prev2[0, 0] += 25.0   # station 0 goes wild
    moved = model(x2, prev2, m, tf)
    assert torch.allclose(base[0, 0], moved[0, 0], atol=1e-5)
    assert not torch.allclose(base[0, 1:], moved[0, 1:], atol=1e-3)
