"""The DataWalk demo: "Financial Market Research", 25 visualizations in 4 rooms, built from
synthetic data. All data is randomly generated: no result describes a real market.

    datawalk demo                      # build it, save datawalk-demo.dwk, and open the editor
    from datawalk.demo import build    # the same report in Python

Needs the plotting libraries: the `charts` extra (docs/install.md).
"""

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import seaborn as sns

import datawalk as dw


def build() -> dw.Report:
    """Build the demo report (about 2 seconds)."""
    rng = np.random.default_rng(42)
    sns.set_theme(style="whitegrid")

    # -- synthetic market ---------------------------------------------------------
    days = pd.bdate_range("2021-01-01", periods=1000)
    vol_regime = 0.012 + 0.01 * (np.sin(np.arange(1000) / 90) > 0.6)
    returns = rng.normal(0.0004, vol_regime)
    price = 100 * np.exp(np.cumsum(returns))
    volume = rng.lognormal(14, 0.35, 1000) * (1 + 40 * np.abs(returns))
    market = pd.DataFrame({"date": days, "price": price, "ret": returns, "volume": volume})
    market["vol21"] = market["ret"].rolling(21).std() * np.sqrt(252)
    market["drawdown"] = market["price"] / market["price"].cummax() - 1

    # -- synthetic features and model --------------------------------------------
    features = pd.DataFrame(
        {
            "momentum_5": market["ret"].rolling(5).sum(),
            "momentum_21": market["ret"].rolling(21).sum(),
            "volatility_21": market["vol21"],
            "volume_z": (market["volume"] - market["volume"].rolling(21).mean())
            / market["volume"].rolling(21).std(),
            "rsi_proxy": market["ret"].rolling(14).apply(lambda r: (r > 0).mean()),
        }
    ).dropna()
    target = (market["ret"].shift(-1).loc[features.index] > 0).astype(int)
    signal = 0.6 * features["momentum_5"] / features["momentum_5"].std() + rng.normal(
        0, 1, len(features)
    )
    score = 1 / (1 + np.exp(-signal))

    def roc(y, s):
        order = np.argsort(-s)
        y = np.asarray(y)[order]
        tpr = np.cumsum(y) / y.sum()
        fpr = np.cumsum(1 - y) / (1 - y).sum()
        return np.r_[0, fpr], np.r_[0, tpr]

    report = dw.Report(
        "Financial Market Research",
        description="Synthetic demonstration report. All data is randomly generated.",
    )

    # Room 1: Market Overview
    fig = px.line(
        market, x="date", y="price", title="Historical Price", labels={"price": "Price (USD)"}
    )
    report.add(fig, key="price", room="Market Overview")
    start, end = market["price"].iloc[0], market["price"].iloc[-1]
    report.get("price").overrides.explanation.findings = [
        f"Price moves from {start:.1f} to {end:.1f} USD ({end / start - 1:+.1%}) over the period.",
        f"Largest drawdown: {market['drawdown'].min():.1%}.",
    ]

    f, ax = plt.subplots(figsize=(8, 5))
    sns.histplot(market["ret"], bins=60, kde=True, ax=ax)
    ax.set(title="Daily Returns Distribution", xlabel="Daily return", ylabel="Days")
    report.add(f, key="returns_dist", room="Market Overview")

    f, ax = plt.subplots(figsize=(10, 4.5))
    ax.plot(market["date"], market["vol21"], label="21-day realized volatility")
    ax.set(title="Rolling Volatility", ylabel="Annualized volatility")
    ax.legend()
    report.add(f, key="volatility", room="Market Overview")

    fig = px.bar(market.tail(120), x="date", y="volume", title="Trading Volume (last 120 days)")
    report.add(fig, key="volume", room="Market Overview")

    f, ax = plt.subplots(figsize=(10, 4.5))
    ax.fill_between(market["date"], market["drawdown"], 0, color="#c0392b", alpha=0.4)
    ax.plot(market["date"], market["drawdown"], color="#c0392b", lw=1, label="Drawdown")
    ax.set(title="Drawdown from Peak", ylabel="Drawdown")
    report.add(f, key="drawdown", room="Market Overview")

    # The three time series share their dates: selecting a period in one marks it in all.
    report.link(["price", "volatility", "drawdown"], name="Market history")
    report.attach_dataset(
        market[["date", "price", "ret", "volume"]],
        key="market_daily",
        name="Daily market data",
        description="Synthetic daily price, return and volume series behind the market charts.",
        visualizations=["price", "volatility", "volume", "drawdown"],
    )

    report.add_kpi(
        "kpi_price",
        "Final Price",
        end,
        unit="USD",
        fmt=",.2f",
        delta=end / start - 1,
        delta_fmt="+.1%",
        room=None,  # shown only on the dashboard below
    )
    report.add_kpi(
        "kpi_vol",
        "Volatility (21-day, annualized)",
        market["vol21"].iloc[-1],
        fmt=".1%",
        delta=market["vol21"].iloc[-1] - market["vol21"].mean(),
        delta_fmt="+.1%",
        higher_is_better=False,
        room=None,
    )
    report.add_kpi("kpi_dd", "Maximum Drawdown", market["drawdown"].min(), fmt=".1%", room=None)
    report.add_dashboard(
        "Headline Figures", ["kpi_price", "kpi_vol", "kpi_dd"], room="Market Overview"
    )

    # Room 2: Feature Engineering
    f, ax = plt.subplots(figsize=(7, 6))
    sns.heatmap(features.corr(), annot=True, fmt=".2f", cmap="vlag", center=0, ax=ax)
    ax.set_title("Feature Correlations")
    report.add(f, key="correlations", room="Feature Engineering")

    importance = pd.Series(np.abs(rng.normal(1, 0.5, 5)), index=features.columns).sort_values()
    f, ax = plt.subplots(figsize=(8, 5))
    ax.barh(importance.index, importance.values, color="#2e86c1")
    ax.set(title="Feature Importance", xlabel="Mean |SHAP| (synthetic)")
    report.add(f, key="importance", room="Feature Engineering")

    lags = np.arange(1, 31)
    acf = [market["ret"].autocorr(lag) for lag in lags]
    f, ax = plt.subplots(figsize=(9, 4.5))
    ax.stem(lags, acf)
    ax.axhline(1.96 / np.sqrt(len(market)), ls="--", color="grey")
    ax.axhline(-1.96 / np.sqrt(len(market)), ls="--", color="grey")
    ax.set(title="Return Autocorrelation", xlabel="Lag (days)", ylabel="Autocorrelation")
    report.add(f, key="autocorrelation", room="Feature Engineering")

    z = (features - features.mean()) / features.std()
    u, s, vt = np.linalg.svd(z.values, full_matrices=False)
    pcs = pd.DataFrame(u[:, :3] * s[:3], columns=["PC1", "PC2", "PC3"])
    pcs["next_day_up"] = target.values.astype(str)
    fig = px.scatter(
        pcs, x="PC1", y="PC2", color="next_day_up", opacity=0.6, title="PCA of Features"
    )
    report.add(fig, key="pca", room="Feature Engineering")
    fig = px.scatter_3d(
        pcs, x="PC1", y="PC2", z="PC3", color="next_day_up", title="PCA of Features (3D)"
    )
    report.add(fig, key="pca_3d", room="Feature Engineering")

    long = features.melt(var_name="feature", value_name="value")
    grid = sns.displot(
        long, x="value", col="feature", col_wrap=3, height=2.6, facet_kws={"sharex": False}
    )
    grid.figure.suptitle("Feature Distributions", y=1.02)
    report.add(grid, key="feature_dists", room="Feature Engineering")

    # Room 3: Model Evaluation
    pred = (score > 0.5).astype(int)
    cm = pd.crosstab(target, pred, rownames=["Actual"], colnames=["Predicted"])
    f, ax = plt.subplots(figsize=(5.5, 4.5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues", ax=ax)
    ax.set_title("Confusion Matrix")
    report.add(f, key="confusion", room="Model Evaluation")

    fpr, tpr = roc(target, score)
    auc = np.trapezoid(tpr, fpr)
    fig = go.Figure(go.Scatter(x=fpr, y=tpr, mode="lines", name=f"Model (AUC {auc:.2f})"))
    fig.add_trace(go.Scatter(x=[0, 1], y=[0, 1], mode="lines", line_dash="dash", name="Chance"))
    fig.update_layout(
        title="ROC Curve", xaxis_title="False positive rate", yaxis_title="True positive rate"
    )
    report.add(fig, key="roc", room="Model Evaluation")

    order = np.argsort(-score.values)
    hits = target.values[order]
    precision = np.cumsum(hits) / np.arange(1, len(hits) + 1)
    recall = np.cumsum(hits) / hits.sum()
    f, ax = plt.subplots(figsize=(7, 5))
    ax.plot(recall, precision, label="Model")
    ax.axhline(target.mean(), ls="--", color="grey", label="Base rate")
    ax.set(title="Precision-Recall Curve", xlabel="Recall", ylabel="Precision")
    ax.legend()
    report.add(f, key="pr_curve", room="Model Evaluation")

    models = pd.DataFrame(
        {
            "model": ["Logistic", "Random forest", "Gradient boosting", "Naive"],
            "AUC": [auc, auc + 0.01, auc + 0.02, 0.5],
        }
    )
    fig = px.bar(models, x="model", y="AUC", title="Model Comparison", range_y=[0.4, 0.7])
    report.add(fig, key="model_comparison", room="Model Evaluation")

    windows = pd.DataFrame(
        {"window": np.arange(1, 13), "accuracy": 0.52 + rng.normal(0, 0.02, 12).cumsum() / 4}
    )
    fig = px.line(windows, x="window", y="accuracy", markers=True, title="Walk-forward Evaluation")
    report.add(fig, key="walk_forward", room="Model Evaluation")
    report.get(
        "walk_forward"
    ).overrides.explanation.methodology = (
        "12 expanding training windows; each is evaluated on the following month."
    )

    metrics = pd.DataFrame(
        {
            "model": ["Logistic", "Random forest", "Gradient boosting", "Naive"],
            "AUC": models["AUC"].round(4),
            "accuracy": [0.531, 0.534, 0.538, 0.5],
            "trades": [412, 398, 377, 0],
        }
    ).set_index("model")
    metrics.attrs["title"] = "Model Metrics"
    report.add(metrics, key="metrics", room="Model Evaluation")

    lookbacks = np.arange(5, 65, 5)
    thresholds = np.linspace(0.45, 0.6, 16)
    grid_acc = 0.52 + 0.015 * np.exp(-((lookbacks[:, None] - 25) ** 2) / 300) * np.cos(
        (thresholds[None, :] - 0.52) * 25
    )
    fig = go.Figure(go.Surface(z=grid_acc, x=thresholds, y=lookbacks))
    fig.update_layout(
        title="Hyperparameter Sweep",
        scene={
            "xaxis_title": "Decision threshold",
            "yaxis_title": "Lookback (days)",
            "zaxis_title": "Accuracy",
        },
    )
    report.add(fig, key="sweep", room="Model Evaluation")
    report.add_dashboard("Classifier Curves", ["roc", "pr_curve"], room="Model Evaluation")

    # Executive summary: the first room. The analyst writes the findings; each one names the
    # charts that support it. DataWalk never writes findings itself.
    report.add_summary(
        kpis=["kpi_price", "kpi_vol", "kpi_dd"],
        findings=[
            (
                f"The price moves from {start:.1f} to {end:.1f} USD ({end / start - 1:+.1%}).",
                ["price"],
            ),
            (
                f"Volatility peaks at {market['vol21'].max():.1%} (annualized). "
                f"The deepest drawdown is {market['drawdown'].min():.1%}.",
                ["volatility", "drawdown"],
            ),
            (f"The classifier reaches a ROC AUC of {auc:.2f}; chance is 0.50.", ["roc"]),
        ],
        author="DataWalk demo (synthetic data)",
        date=str(pd.Timestamp.today().date()),
        data_cutoff=str(days[-1].date()),
    )
    # Speaker notes for the guided tour (presenter view and PowerPoint export only).
    report.tour_stop("price").notes = (
        f"Start at {start:.1f} USD; the period ends at {end:.1f} USD. "
        "Select a period here: the volatility and drawdown charts mark it too."
    )
    plt.close("all")
    return report
