# WeatherGuard — judge demo (90 seconds)

## Before the judges arrive

- [ ] Backend running (`uvicorn app.main:app --port 8000`, or the deployed URL opened a minute early; free hosting sleeps).
      The nav should say **● Server**. Without it the browser engine takes over and some scores differ.
- [ ] Open the console. For restarts during Q&A use `?intro=0` to skip the opening.
- [ ] Press **Reset replay** (↺, bottom right) so the replay is at Day 2 · 14:45.
- [ ] Laptop at 100% zoom, light theme for projectors (moon/sun icon, top right).

## The 90 seconds

| Time | Do | Say |
|---|---|---|
| 0–10 s | Let the intro finish on the Overview. | "Weather stations fail silently. Rule-based checks can't tell a broken sensor from a real storm, so bad data reaches forecasts and real extremes get thrown away." |
| 10–20 s | Point at the four figures, then the map. | "Twelve IMD stations on the Konkan coast and Western Ghats. Four have problems right now." |
| 20–45 s | Alibag is selected. Choose **Stuck sensor**, press **Simulate sensor fault**. | "We freeze this thermometer. Watch the pipeline: it streams the data, catches the fault after 75 minutes, then runs five independent checks: physics, time, neighbours through our graph network, the learned baseline, and radar." |
| 45–60 s | The decision lands: **Sensor fault.** | "Rejected, replaced with the neighbour-predicted value, work order raised. Legacy QC takes four hours to notice." Scroll to **Impact**: "that's how many bad readings reach forecasters with and without us." |
| 60–75 s | Scroll to **One reading, two verdicts**. | "The other half: during this storm, legacy QC threw out 11 genuine readings. We kept all 79, because radar and satellite confirm them." |
| 75–90 s | Open **Real data**. | "And it isn't just simulation. On 18,020 real 2023 reports from these same stations, NOAA's rule-based QC flagged 136 readings; 126 of them agree with their neighbours. Here's Mahabaleshwar on 19 April: flagged suspect, but it was a real thunderstorm: cumulonimbus, 11 mm of rain, thunder reported next door. We keep it." |

If there is time: **Humidity drift** at the same station is caught after about 14 hours; legacy QC never catches it.

## Questions to expect, with honest answers

**Is the data real?**
The live demo runs on a deterministic simulator, so every fault's timing is known and recall can be measured
exactly. The Real data page runs the same checks on real 2023 IMD observations from NOAA's archive.

**Where is the AI, and how much does it do?**
It's a hybrid. The ST-GNN predicts each station from its neighbours and terrain (28–53% lower error than
inverse-distance weighting). The LSTM autoencoder scores four-hour patterns. On its own the autoencoder catches 21%
of faults; the full pipeline catches 85% at zero false alarms, because physics rules, the radar cross-check and
trend detectors cover what a single model misses. Isolation Forest, LOF and One-Class SVM reach 0.5–19% on the
same data (Evaluation page).

**Do the models run on the real data?**
Not yet: they were trained on simulated 15-minute data, and the real archive is 3-hourly. The physics, spike,
stuck-sensor and neighbour checks run on it today. Retraining on real series is the next step.

**Are the real-data flags confirmed faults?**
No. Real data has no ground truth, so we call them inconsistencies and show the evidence for each one.

**What replaces radar on real data?**
Independent weather reports from the station and its neighbours: thunderstorm and rain codes, cumulonimbus cloud
and measured rain.

**Can it run at the station?**
The autoencoder exports to a 22 KB int8 ONNX file (47 KB full precision; ST-GNN 107 KB), inside a TinyML budget.
The server runs ONNX Runtime, not PyTorch.

**What would you need from IMD?**
Fifteen-minute AWS data with maintenance logs (for ground truth), and DWR radar access for the external check.

## If something goes wrong

- **Server down:** the console falls back to the in-browser engine automatically (nav says **Browser**); the demo
  still works.
- **Replay somewhere odd:** press ↺ in the replay strip.
- **Simulation said "not detected before the replay ends":** you ran it too late in the replay; reset and run again.
