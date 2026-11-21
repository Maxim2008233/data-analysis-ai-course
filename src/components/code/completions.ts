// Базовое автодополнение после «np.», «pd.», «plt.», «df.» и т. п.
const NP = [
  "array()", "arange()", "linspace()", "zeros()", "ones()", "full()", "mean()", "median()", "std()", "var()", "min()", "max()",
  "sum()", "cumsum()", "argmax()", "argmin()", "argsort()", "sort()", "quantile()", "percentile()", "histogram()", "isnan()",
  "isfinite()", "isinf()", "nanmean()", "nanmedian()", "nanstd()", "nanmin()", "nanmax()", "count_nonzero()", "where()",
  "unique()", "column_stack()", "vstack()", "hstack()", "concatenate()", "reshape()", "round()", "abs()", "sqrt()", "log()",
  "log1p()", "exp()", "clip()", "ptp()", "corrcoef()", "dot()", "genfromtxt()", "loadtxt()", "random", "nan", "inf",
  "set_printoptions()", "allclose()", "isclose()", "any()", "all()", "logical_and()", "logical_or()", "diff()", "float64", "int64",
];
const PD = [
  "read_csv()", "DataFrame()", "Series()", "concat()", "merge()", "pivot_table()", "crosstab()", "cut()", "qcut()",
  "get_dummies()", "to_numeric()", "to_datetime()", "isna()", "notna()", "set_option()", "NA",
];
const DF = [
  "head()", "tail()", "info()", "describe()", "shape", "columns", "index", "dtypes", "loc", "iloc", "copy()", "sort_values()",
  "sort_index()", "value_counts()", "unique()", "nunique()", "isna()", "notna()", "dropna()", "fillna()", "drop()",
  "drop_duplicates()", "duplicated()", "rename()", "reset_index()", "set_index()", "groupby()", "agg()", "mean()",
  "median()", "sum()", "count()", "size", "min()", "max()", "std()", "quantile()", "apply()", "map()", "astype()",
  "query()", "isin()", "between()", "to_csv()", "plot", "style", "corr()", "sample()", "nlargest()", "nsmallest()",
  "pivot_table()", "assign()", "clip()", "round()", "str", "abs()", "cumsum()", "idxmax()", "idxmin()", "to_numpy()",
];
const PLT = [
  "figure()", "subplots()", "plot()", "scatter()", "bar()", "barh()", "hist()", "boxplot()", "pie()", "title()", "xlabel()",
  "ylabel()", "legend()", "grid()", "xticks()", "yticks()", "xlim()", "ylim()", "tight_layout()", "show()", "savefig()",
  "axhline()", "axvline()", "text()", "annotate()", "suptitle()", "gca()", "gcf()", "close()",
];
const AX = [
  "plot()", "scatter()", "bar()", "barh()", "hist()", "boxplot()", "pie()", "set_title()", "set_xlabel()", "set_ylabel()",
  "legend()", "grid()", "set_xticks()", "set_xticklabels()", "set_xlim()", "set_ylim()", "axhline()", "axvline()",
  "text()", "annotate()", "bar_label()", "set_yscale()", "set_xscale()", "invert_yaxis()", "spines", "tick_params()", "hexbin()",
];
const SNS = ["histplot()", "boxplot()", "violinplot()", "kdeplot()", "ecdfplot()", "scatterplot()", "barplot()", "countplot()", "stripplot()", "heatmap()", "pairplot()", "lineplot()", "set_theme()"];
const PX = ["scatter()", "bar()", "histogram()", "box()", "treemap()", "sunburst()", "line()", "pie()"];
const RNG = ["choice()", "integers()", "random()", "normal()", "permutation()", "shuffle()"];

export const LIBRARY_COMPLETIONS: Record<string, string[]> = {
  np: NP,
  numpy: NP,
  pd: PD,
  pandas: PD,
  df: DF,
  raw: DF,
  data: DF,
  clean: DF,
  cars: DF,
  plt: PLT,
  ax: AX,
  sns: SNS,
  px: PX,
  rng: RNG,
};
