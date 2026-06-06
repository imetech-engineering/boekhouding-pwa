import tkinter as tk
from tkinter import ttk, messagebox, simpledialog

import customtkinter as ctk
from datetime import datetime, timedelta
from collections import defaultdict
import gc
import io
import openpyxl
import os
import sys
import tempfile
import time
from copy import copy
from openpyxl.utils.cell import coordinate_from_string

_DESK_APPS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _DESK_APPS not in sys.path:
    sys.path.insert(0, _DESK_APPS)
import imtech_desk_theme as desk

if getattr(sys, "frozen", False):
    _APP_DIR = os.path.dirname(sys.executable)
else:
    _APP_DIR = os.path.dirname(os.path.abspath(__file__))

# === CONFIG ===
from uren_analyse_agg import (
    aggregate_cumulative_for_year,
    aggregate_hours_per_iso_week,
    aggregate_hours_per_locatie,
    aggregate_hours_per_month,
    aggregate_hours_per_opdrachtgever,
    aggregate_revenue_per_month,
    chart_year_from_rows,
    find_similar_entries,
    rows_for_chart_year,
)
from uren_analyse_charts import build_chart_frame
from uren_desktop_extras import (
    APP_VERSION,
    check_for_updates_async,
    create_mini_invoer_popup,
    register_global_hotkey,
    start_system_tray,
)
from uren_estimates_service import (
    DEFAULT_STATUS,
    PROJECT_STATUSES,
    add_estimate_row,
    delete_estimate_row,
    display_delta,
    load_estimate_rows,
    sort_estimates_by_recent_hours,
    summarize_by_status,
    update_estimate_row,
)
from uren_excel_service import (
    EXCEL_PATH,
    SHEET_NAME,
    TABLE_NAME,
    START_ROW,
    COL_DATUM,
    COL_WEEK,
    COL_JAAR,
    COL_OPDRACHTGEVER,
    COL_PROJECT,
    COL_WERKZAAMHEDEN,
    COL_LOCATIE,
    COL_UREN,
    COL_TARIEF,
    NUM_COLS,
    add_entry_to_excel,
    close_excel_workbook_if_open,
    delete_entry_from_excel,
    get_last_entries,
    load_hours_rows,
    sync_excel_workbook_if_open,
    update_entry_in_excel,
    _excel_row_to_entry,
    _iter_hours_sheet_rows,
)


# Design tokens via imtech_desk_theme
THEME_BG = desk.COLORS["bg_secondary"]
THEME_TOP_BAR = desk.COLORS["bg_primary"]
THEME_FIELD_BG = desk.COLORS["bg_secondary"]
THEME_WHITE = desk.COLORS["bg_primary"]
THEME_TEXT_PRIMARY = desk.COLORS["text_primary"]
THEME_TEXT_SECONDARY = desk.COLORS["text_secondary"]
THEME_TEXT_TERTIARY = desk.COLORS["text_tertiary"]
THEME_BORDER = desk.COLORS["border"]
THEME_BORDER_STRONG = desk.COLORS["border_strong"]
THEME_ACCENT = desk.COLORS["accent"]
THEME_ACCENT_HOVER = desk.COLORS["accent_hover"]
THEME_ACCENT_LIGHT = desk.COLORS["accent_light"]
THEME_BG_HOVER = desk.COLORS["bg_hover"]
THEME_BG_TERTIARY = desk.COLORS["bg_tertiary"]
THEME_CANVAS_BG = desk.COLORS["bg_tertiary"]

SPACING_XS = desk.SPACING["xs"]
SPACING_SM = desk.SPACING["sm"]
SPACING_MD = desk.SPACING["md"]
SPACING_LG = desk.SPACING["lg"]
SPACING_XL = desk.SPACING["xl"]
SPACING_XXL = desk.SPACING["xxl"]
RADIUS_SM = desk.RADIUS["sm"]
RADIUS_MD = desk.RADIUS["md"]
RADIUS_LG = desk.RADIUS["lg"]
RADIUS_XL = desk.RADIUS["xl"]
TITLEBAR_HEIGHT = desk.TITLEBAR_HEIGHT
FONT_UI = ("Segoe UI", 11)
FONT_UI_BOLD = ("Segoe UI", 11, "bold")
NAV_PAD_X = RADIUS_MD + 4
BTN_PAD_Y = 8
SIDEBAR_WIDTH = desk.SIDEBAR_WIDTH

NUM_COLS = COL_TARIEF

# Invoer-intelligentie: usage, context en historie (wordt gevuld door load_existing_data)
_invoer_intel = {
    "history": [],
    "og_usage": {},
    "proj_usage": {},
    "loc_usage": {},
    "werk_usage": {},
    "projects_by_og": {},
    "locaties_by_og_proj": {},
    "locaties_by_og": {},
    "werk_by_context": {},
    "last_combo": {},
    "all_werk": [],
}
_history_display = []
_history_filter_after = [None]
HISTORY_DISPLAY_LIMIT = 250
HISTORY_SEARCH_DEBOUNCE_MS = 220
history_status_lbl = None


def _empty_usage():
    return {"count": 0, "uren": 0.0, "last": None}


def _bump_usage(stats, name, uren, dt):
    if not name:
        return
    s = stats.setdefault(name, _empty_usage())
    s["count"] += 1
    s["uren"] += uren
    if s["last"] is None or dt > s["last"]:
        s["last"] = dt


def _sort_names_by_usage(stats, names=None):
    pool = names if names is not None else list(stats.keys())

    def key(name):
        s = stats.get(name, _empty_usage())
        last = s["last"] or datetime.min
        return (-s["uren"], -s["count"], -last.timestamp(), name.lower())

    return sorted(pool, key=key)


def _bump_context_list(bucket, key, value, uren, dt):
    if not value:
        return
    items = bucket.setdefault(key, {})
    s = items.setdefault(value, _empty_usage())
    s["count"] += 1
    s["uren"] += uren
    if s["last"] is None or dt > s["last"]:
        s["last"] = dt


def _sort_context_values(bucket, key):
    items = bucket.get(key, {})
    return _sort_names_by_usage(items)


def _search_rank(option, query):
    o = option.lower()
    q = (query or "").lower()
    if not q:
        return (0, option.lower())
    if o.startswith(q):
        return (0, len(option), option.lower())
    if q in o:
        return (1, o.find(q), option.lower())
    return (2, 0, option.lower())


def _find_prefix_match(text, options):
    text = (text or "").strip()
    if not text:
        return None
    tl = text.lower()
    for opt in options:
        if opt.lower().startswith(tl) and opt.lower() != tl:
            return opt
    return None


def _bind_tab_autocomplete(widget, var, options_fn, on_accept=None):
    """Tab vult aan op basis van prefix (bijv. EST → ESTEDE)."""
    suggestion = [None]
    skip_keys = {
        "Tab", "Return", "Shift_L", "Shift_R", "Control_L", "Control_R",
        "Alt_L", "Alt_R", "Escape", "Up", "Down", "Left", "Right",
    }

    def refresh_suggestion(*_args):
        suggestion[0] = _find_prefix_match(var.get(), options_fn())

    def on_key(event):
        if event.keysym in skip_keys:
            return
        widget.after_idle(refresh_suggestion)

    def accept(event):
        refresh_suggestion()
        if suggestion[0]:
            var.set(suggestion[0])
            suggestion[0] = None
            if on_accept:
                on_accept()
            return "break"
        return None

    widget.bind("<KeyRelease>", on_key)
    widget.bind("<Tab>", accept)
    return suggestion, refresh_suggestion


_invoer_focus_chain = []


def _invoer_focus_widget(w):
    if w is None:
        return
    try:
        w.focus_set()
    except tk.TclError:
        return


def _invoer_focus_next(current):
    if not _invoer_focus_chain or current not in _invoer_focus_chain:
        return
    idx = _invoer_focus_chain.index(current)
    _invoer_focus_widget(_invoer_focus_chain[(idx + 1) % len(_invoer_focus_chain)])


def _invoer_focus_prev(current):
    if not _invoer_focus_chain or current not in _invoer_focus_chain:
        return
    idx = _invoer_focus_chain.index(current)
    _invoer_focus_widget(_invoer_focus_chain[(idx - 1) % len(_invoer_focus_chain)])


def _accept_prefix(var, options_fn, on_accept=None):
    match = _find_prefix_match(var.get(), options_fn()) if options_fn else None
    if match:
        var.set(match)
        if on_accept:
            on_accept()
        return True
    return False


def _bind_invoer_field_nav(widget, var, options_fn=None, on_accept=None, submit_on_enter=False):
    """Tab/Enter: autocomplete, volgend veld, of opslaan — volledig toetsenbord."""
    suggestion = [None]
    skip_keys = {
        "Tab", "Return", "Shift_L", "Shift_R", "Control_L", "Control_R",
        "Alt_L", "Alt_R", "Escape", "Up", "Down", "Left", "Right",
    }

    def refresh_suggestion(*_args):
        suggestion[0] = _find_prefix_match(var.get(), options_fn()) if options_fn else None

    def try_accept():
        refresh_suggestion()
        if suggestion[0]:
            var.set(suggestion[0])
            suggestion[0] = None
            if on_accept:
                on_accept()
            return True
        return False

    def on_tab(event):
        if try_accept():
            return "break"
        _invoer_focus_next(widget)
        return "break"

    def on_shift_tab(event):
        _invoer_focus_prev(widget)
        return "break"

    def on_enter(event):
        if try_accept():
            if submit_on_enter:
                add_entry()
            else:
                _invoer_focus_next(widget)
            return "break"
        if submit_on_enter:
            add_entry()
            return "break"
        _invoer_focus_next(widget)
        return "break"

    def on_key(event):
        if event.keysym in skip_keys:
            return
        widget.after_idle(refresh_suggestion)

    widget.bind("<Tab>", on_tab)
    widget.bind("<Shift-Tab>", on_shift_tab)
    widget.bind("<Return>", on_enter)
    widget.bind("<KeyRelease>", on_key)


def _bind_invoer_datum_keys(widget):
    def on_enter(event):
        _invoer_focus_next(widget)
        return "break"

    def on_tab(event):
        _invoer_focus_next(widget)
        return "break"

    def on_shift_tab(event):
        _invoer_focus_prev(widget)
        return "break"

    def on_left(event):
        adjust_date(-1)
        return "break"

    def on_right(event):
        adjust_date(1)
        return "break"

    widget.bind("<Return>", on_enter)
    widget.bind("<Tab>", on_tab)
    widget.bind("<Shift-Tab>", on_shift_tab)
    widget.bind("<Left>", on_left)
    widget.bind("<Right>", on_right)


def _bind_invoer_uren_keys(widget):
    def on_up(event):
        adjust_hours(0.5)
        return "break"

    def on_down(event):
        adjust_hours(-0.5)
        return "break"

    widget.bind("<Up>", on_up)
    widget.bind("<Down>", on_down)


def _bind_invoer_history_keys(search_widget, history_widget):
    def search_enter(event):
        if _history_filter_after[0] is not None:
            try:
                root.after_cancel(_history_filter_after[0])
            except tk.TclError:
                pass
            refresh_history_list()
        if _history_display:
            apply_history_to_form(_history_display[0], focus_uren=True)
        else:
            _invoer_focus_widget(_invoer_focus_chain[0] if _invoer_focus_chain else None)
        return "break"

    def search_down(event):
        if history_widget is not None:
            history_widget.focus_list()
        return "break"

    search_widget.bind("<Return>", search_enter)
    search_widget.bind("<Down>", search_down)
    if history_widget is not None:
        history_widget.bind_keyboard(search_widget)


def setup_invoer_keyboard_nav():
    """Registreer tab-volgorde en toetsbindingen voor muisvrije invoer."""
    global _invoer_focus_chain
    chain = [
        w
        for w in (
            datum_entry,
            dd_opd._entry if dd_opd else None,
            dd_proj._entry if dd_proj else None,
            dd_loc._entry if dd_loc else None,
            werkzaamheden_entry,
            uren_entry,
            tarief_entry,
        )
        if w is not None
    ]
    _invoer_focus_chain = chain

    if datum_entry is not None:
        _bind_invoer_datum_keys(datum_entry)
    if dd_opd is not None:
        _bind_invoer_field_nav(dd_opd._entry, opdrachtgever_var, smart_opdrachtgevers, _on_dropdown_selected)
    if dd_proj is not None:
        _bind_invoer_field_nav(dd_proj._entry, project_var, smart_projecten, _on_dropdown_selected)
    if dd_loc is not None:
        _bind_invoer_field_nav(dd_loc._entry, locatie_var, smart_locaties, _on_dropdown_selected)
    if werkzaamheden_entry is not None:
        _bind_invoer_field_nav(
            werkzaamheden_entry, werkzaamheden_var, smart_werkzaamheden, submit_on_enter=True
        )

        def _werk_down(event):
            open_werkzaamheden_popup()
            return "break"

        werkzaamheden_entry.bind("<Down>", _werk_down)
    if uren_entry is not None:
        _bind_invoer_field_nav(uren_entry, uren_var, submit_on_enter=True)
        _bind_invoer_uren_keys(uren_entry)
    if tarief_entry is not None:
        _bind_invoer_field_nav(tarief_entry, tarief_var, submit_on_enter=True)
    if history_search_entry is not None and history_scroll_list is not None:
        _bind_invoer_history_keys(history_search_entry, history_scroll_list)

    root.bind("<Control-Return>", lambda e: add_entry())
    root.bind("<Control-KP_Enter>", lambda e: add_entry())


def _bind_tab_autocomplete_plain(widget, get_text, set_text, options_fn, on_accept=None):
    """Tab-autocomplete voor velden zonder StringVar."""
    suggestion = [None]
    skip_keys = {
        "Tab", "Return", "Shift_L", "Shift_R", "Control_L", "Control_R",
        "Alt_L", "Alt_R", "Escape", "Up", "Down", "Left", "Right",
    }

    def refresh_suggestion(*_args):
        suggestion[0] = _find_prefix_match(get_text(), options_fn())

    def on_key(event):
        if event.keysym in skip_keys:
            return
        widget.after_idle(refresh_suggestion)

    def accept(event):
        refresh_suggestion()
        if suggestion[0]:
            set_text(suggestion[0])
            suggestion[0] = None
            if on_accept:
                on_accept()
            return "break"
        return None

    widget.bind("<KeyRelease>", on_key)
    widget.bind("<Tab>", accept)


def smart_opdrachtgevers():
    ogs = globals().get("opdrachtgevers") or []
    return _sort_names_by_usage(_invoer_intel["og_usage"], ogs)


def smart_projecten():
    og_var = globals().get("opdrachtgever_var")
    projs = globals().get("projecten") or []
    og = (og_var.get() if og_var else "").strip()
    if og and og in _invoer_intel["projects_by_og"]:
        return _sort_context_values(_invoer_intel["projects_by_og"], og)
    return _sort_names_by_usage(_invoer_intel["proj_usage"], projs)


def smart_locaties():
    og_var = globals().get("opdrachtgever_var")
    proj_var = globals().get("project_var")
    locs = globals().get("locaties") or []
    og = (og_var.get() if og_var else "").strip()
    proj = (proj_var.get() if proj_var else "").strip()
    key = (og, proj)
    if og and proj and key in _invoer_intel["locaties_by_og_proj"]:
        return _sort_context_values(_invoer_intel["locaties_by_og_proj"], key)
    if og and og in _invoer_intel["locaties_by_og"]:
        return _sort_context_values(_invoer_intel["locaties_by_og"], og)
    return _sort_names_by_usage(_invoer_intel["loc_usage"], locs)


def smart_werkzaamheden():
    og_var = globals().get("opdrachtgever_var")
    proj_var = globals().get("project_var")
    loc_var = globals().get("locatie_var")
    og = (og_var.get() if og_var else "").strip()
    proj = (proj_var.get() if proj_var else "").strip()
    loc = (loc_var.get() if loc_var else "").strip()
    key = (og, proj, loc)
    if og and proj and loc and key in _invoer_intel["werk_by_context"]:
        return _sort_context_values(_invoer_intel["werk_by_context"], key)
    return list(_invoer_intel["all_werk"])


def create_searchable_dropdown(parent, var, options_list_fn, command=None, width=30):
    """Zoekbare lijst met Tab-autocomplete en slim gesorteerde opties."""
    def get_options():
        return list(options_list_fn()) if callable(options_list_fn) else list(options_list_fn)

    frame = ctk.CTkFrame(parent, fg_color="transparent", corner_radius=0)
    entry = desk.standard_entry(frame, textvariable=var, width=max(200, width * 8))
    entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
    btn_drop = desk.icon_outline_button(frame, text="▼ Kies", width=72)
    btn_drop.pack(side=tk.RIGHT, padx=(SPACING_XS, 0))

    popup_ref = [None]

    def close_popup():
        if popup_ref[0] and popup_ref[0].winfo_exists():
            popup_ref[0].destroy()
        popup_ref[0] = None

    def open_popup(evt=None):
        if popup_ref[0] and popup_ref[0].winfo_exists():
            close_popup()
            return

        full = get_options()
        pop = ctk.CTkToplevel(root)
        popup_ref[0] = pop
        pop.wm_title("")
        pop.transient(root)
        pop.configure(fg_color=THEME_WHITE)
        x = entry.winfo_rootx()
        y = entry.winfo_rooty() + entry.winfo_height()
        pop.geometry("+%d+%d" % (x, y))
        pop.attributes("-topmost", True)

        outer = ctk.CTkFrame(pop, fg_color=THEME_WHITE, corner_radius=desk.RADIUS["md"], border_width=1, border_color=THEME_BORDER)
        outer.pack(fill=tk.BOTH, expand=True, padx=2, pady=2)

        typed = var.get().strip()
        search_var = tk.StringVar(value=typed)
        e_search = desk.standard_entry(outer, textvariable=search_var, width=max(280, width * 9))
        e_search.pack(fill=tk.X, padx=SPACING_SM, pady=SPACING_SM)

        inner = tk.Frame(outer, bg=THEME_WHITE)
        inner.pack(fill=tk.BOTH, expand=True, padx=SPACING_SM, pady=(0, SPACING_SM))
        lb = tk.Listbox(
            inner,
            height=min(14, max(4, len(full))),
            width=max(width + 5, 40),
            font=FONT_UI,
            exportselection=False,
            bg=THEME_WHITE,
            fg=THEME_TEXT_PRIMARY,
            selectbackground=THEME_ACCENT_LIGHT,
            selectforeground=THEME_ACCENT,
        )
        scroll = ttk.Scrollbar(inner, orient=tk.VERTICAL, command=lb.yview)
        lb.configure(yscrollcommand=scroll.set)
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        lb.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        def fill_list(opt_list):
            lb.delete(0, tk.END)
            for o in opt_list:
                lb.insert(tk.END, o)
            if opt_list:
                lb.selection_set(0)
                lb.activate(0)

        def on_filter(*args):
            q = search_var.get().lower().strip()
            if not q:
                filtered = list(full)
            else:
                filtered = [o for o in full if q in o.lower()]
            filtered.sort(key=lambda o: _search_rank(o, q))
            fill_list(filtered)

        search_var.trace_add("write", lambda *a: on_filter())

        def select_and_close(evt=None):
            sel = lb.curselection()
            if sel:
                var.set(lb.get(sel[0]))
            close_popup()
            if command:
                command()

        lb.bind("<Double-1>", select_and_close)
        lb.bind("<Return>", select_and_close)
        e_search.bind("<Return>", select_and_close)

        def on_escape(evt):
            close_popup()

        e_search.bind("<Escape>", on_escape)
        lb.bind("<Escape>", on_escape)
        pop.bind("<Escape>", on_escape)
        e_search.bind("<Down>", lambda ev: lb.focus_set())
        e_search.bind("<Tab>", select_and_close)

        def check_focus_out():
            try:
                w = root.focus_get()
                if w is None:
                    return
                if w.winfo_toplevel() == pop:
                    return
                close_popup()
            except tk.TclError:
                pass

        pop.bind("<FocusOut>", lambda e: pop.after(120, check_focus_out))

        on_filter()
        pop.after(10, e_search.focus_set)
        if evt is not None:
            return "break"

    btn_drop.configure(command=open_popup)
    entry.bind("<Down>", open_popup)

    class ComboWrap:
        def __init__(self):
            self._frame = frame
            self._entry = entry

        def grid(self, **kw):
            self._frame.grid(**kw)

        def pack(self, **kw):
            self._frame.pack(**kw)

        def set(self, v):
            var.set(v if v is not None else "")

        def __getitem__(self, key):
            if key == "values":
                return get_options()
            raise KeyError(key)

        def __setitem__(self, key, value):
            if key != "values":
                self._entry[key] = value

    return ComboWrap()


def _make_horizontal_chip_scroller(parent, height=52):
    """Frame met Canvas + horizontale scrollbar; retourneert (wrap, canvas, inner_frame)."""
    wrap = ctk.CTkFrame(parent, fg_color="transparent", corner_radius=0)
    wrap.grid_columnconfigure(0, weight=1)
    sb = ttk.Scrollbar(wrap, orient=tk.HORIZONTAL)
    cv = tk.Canvas(
        wrap,
        height=height,
        bg=THEME_BG,
        highlightthickness=0,
        xscrollcommand=sb.set,
    )
    sb.config(command=cv.xview)
    cv.grid(row=0, column=0, sticky="ew")
    sb.grid(row=1, column=0, sticky="ew")
    inner = tk.Frame(cv, bg=THEME_BG)
    cv.create_window((0, 0), window=inner, anchor="nw")

    def _sync_scrollregion(event=None):
        cv.update_idletasks()
        bbox = cv.bbox("all")
        if bbox:
            cv.configure(scrollregion=bbox)

    inner.bind("<Configure>", lambda e: _sync_scrollregion())
    cv.bind("<Configure>", lambda e: _sync_scrollregion())

    def _wheel_horizontal(e):
        if getattr(e, "delta", 0):
            cv.xview_scroll(-1 if e.delta > 0 else 1, "units")

    cv.bind("<Shift-MouseWheel>", _wheel_horizontal)
    inner.bind("<Shift-MouseWheel>", _wheel_horizontal)
    cv.bind("<Enter>", lambda e: cv.focus_set())

    return wrap, cv, inner


def load_existing_data():
    """Laad lijsten, tarief-maps, usage-intelligentie en historie."""
    empty_intel = {
        "history": [],
        "og_usage": {},
        "proj_usage": {},
        "loc_usage": {},
        "werk_usage": {},
        "projects_by_og": {},
        "locaties_by_og_proj": {},
        "locaties_by_og": {},
        "werk_by_context": {},
        "last_combo": {},
        "all_werk": [],
    }
    if not os.path.exists(EXCEL_PATH):
        messagebox.showerror("Fout", f"Bestand niet gevonden:\n{EXCEL_PATH}")
        _invoer_intel.update(empty_intel)
        return [], [], [], {}, {}, {}, None, None, None

    tarieven_pair = {}
    last_by_project = {}
    last_by_opdrachtgever = {}
    last_opd, last_proj, last_loc = None, None, None
    intel = {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else {}) for k, v in empty_intel.items()}
    intel["all_werk"] = []
    history = []

    try:
        sheet_rows = _iter_hours_sheet_rows()
    except Exception:
        messagebox.showerror("Fout", f"Kon urenbestand niet lezen:\n{EXCEL_PATH}")
        _invoer_intel.update(empty_intel)
        return [], [], [], {}, {}, {}, None, None, None

    for row_idx, row in sheet_rows:
        entry = _excel_row_to_entry(row, row_idx)
        if entry is None:
            continue

        og, proj, loc, wz = entry["opdrachtgever"], entry["project"], entry["locatie"], entry["werkzaamheden"]
        uren, dt, tarief = entry["uren"], entry["datum"], entry["tarief"]
        history.append(entry)
        _prepare_history_entry_cache(entry)

        _bump_usage(intel["og_usage"], og, uren, dt)
        _bump_usage(intel["proj_usage"], proj, uren, dt)
        _bump_usage(intel["loc_usage"], loc, uren, dt)
        _bump_usage(intel["werk_usage"], wz, uren, dt)

        if og:
            _bump_context_list(intel["projects_by_og"], og, proj, uren, dt)
            _bump_context_list(intel["locaties_by_og"], og, loc, uren, dt)
        if og and proj:
            _bump_context_list(intel["locaties_by_og_proj"], (og, proj), loc, uren, dt)
            intel["last_combo"][(og, proj)] = entry
        if og and proj and loc:
            _bump_context_list(intel["werk_by_context"], (og, proj, loc), wz, uren, dt)

        if wz and wz not in intel["all_werk"]:
            intel["all_werk"].append(wz)

        if og:
            last_opd = og
        if proj:
            last_proj = proj
        if loc:
            last_loc = loc
        if og and proj and tarief is not None:
            tarieven_pair[(og, proj)] = tarief
            last_by_project[proj] = tarief
            last_by_opdrachtgever[og] = tarief

    history.reverse()
    intel["history"] = history
    intel["all_werk"] = _sort_names_by_usage(intel["werk_usage"], intel["all_werk"])
    _invoer_intel.update(intel)

    opdrachtgevers = _sort_names_by_usage(intel["og_usage"])
    projecten = _sort_names_by_usage(intel["proj_usage"])
    locaties = _sort_names_by_usage(intel["loc_usage"])

    return (
        opdrachtgevers,
        projecten,
        locaties,
        tarieven_pair,
        last_by_project,
        last_by_opdrachtgever,
        last_opd,
        last_proj,
        last_loc,
    )


def format_history_line(entry):
    """Leesbare regel voor historie-lijst."""
    if isinstance(entry, dict):
        d = entry["datum"]
        ds = d.strftime("%Y-%m-%d") if isinstance(d, datetime) else str(d)[:10]
        og = entry.get("opdrachtgever") or ""
        pr = entry.get("project") or ""
        loc = entry.get("locatie") or ""
        wz = (entry.get("werkzaamheden") or "")[:36]
        ur = entry.get("uren", 0)
        tr = entry.get("tarief", 0)
        return f"{ds} | {og} | {pr} | {loc} | {wz} | {ur} u × €{tr}"
    return format_last_entry_line(entry)


class HistoryScrollList:
    """Scrollbare historielijst met hover-bewerken/verwijderen."""

    ROW_H = 28

    def __init__(self, parent):
        self._entries = []
        self._selected = 0
        self._row_parts = []
        self._hover_idx = None
        self._search_widget = None

        wrap = tk.Frame(parent, bg=THEME_BG, highlightthickness=0)
        wrap.pack(fill=tk.BOTH, expand=True)
        wrap.grid_rowconfigure(0, weight=1)
        wrap.grid_columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(
            wrap,
            bg=THEME_WHITE,
            highlightthickness=0,
            borderwidth=0,
            takefocus=1,
        )
        sb = ttk.Scrollbar(wrap, orient=tk.VERTICAL, command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=sb.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        sb.grid(row=0, column=1, sticky="ns")

        self.inner = tk.Frame(self.canvas, bg=THEME_WHITE, highlightthickness=0)
        self._inner_id = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", self._on_inner_configure)
        self.canvas.bind("<Configure>", self._on_canvas_configure)

        for w in (self.canvas, self.inner, wrap):
            w.bind("<MouseWheel>", self._on_mousewheel)
            w.bind("<Button-4>", lambda e: self.canvas.yview_scroll(-1, "units"))
            w.bind("<Button-5>", lambda e: self.canvas.yview_scroll(1, "units"))

        self._wrap = wrap

    def _on_inner_configure(self, _event=None):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _on_canvas_configure(self, event):
        self.canvas.itemconfigure(self._inner_id, width=event.width)

    def _on_mousewheel(self, event):
        delta = getattr(event, "delta", 0)
        if delta:
            self.canvas.yview_scroll(-1 if delta > 0 else 1, "units")
        return "break"

    def _pointer_in_widget(self, widget):
        try:
            x, y = widget.winfo_pointerxy()
            w = widget.winfo_containing(x, y)
            while w is not None:
                if w == widget:
                    return True
                w = w.master
        except tk.TclError:
            pass
        return False

    def _hide_actions(self, idx):
        if idx < 0 or idx >= len(self._row_parts):
            return
        parts = self._row_parts[idx]
        parts["actions"].pack_forget()
        bg = THEME_ACCENT_LIGHT if idx == self._selected else THEME_WHITE
        parts["row"].configure(bg=bg)
        parts["lbl"].configure(bg=bg)
        parts["actions"].configure(bg=bg)

    def _show_actions(self, idx):
        if idx < 0 or idx >= len(self._row_parts):
            return
        parts = self._row_parts[idx]
        parts["actions"].pack(side=tk.RIGHT, padx=(0, 4))
        parts["row"].configure(bg=THEME_BG_HOVER)
        parts["lbl"].configure(bg=THEME_BG_HOVER)
        parts["actions"].configure(bg=THEME_BG_HOVER)

    def _on_row_enter(self, idx):
        if self._hover_idx is not None and self._hover_idx != idx:
            self._hide_actions(self._hover_idx)
        self._hover_idx = idx
        self._show_actions(idx)

    def _on_row_leave(self, idx):
        parts = self._row_parts[idx]["row"]

        def check():
            if self._hover_idx != idx:
                return
            if self._pointer_in_widget(parts):
                return
            self._hide_actions(idx)
            if self._hover_idx == idx:
                self._hover_idx = None

        parts.after(60, check)

    def _select(self, idx, scroll=True):
        if not self._entries:
            self._selected = 0
            return
        idx = max(0, min(idx, len(self._entries) - 1))
        for i, parts in enumerate(self._row_parts):
            bg = THEME_ACCENT_LIGHT if i == idx else THEME_WHITE
            parts["row"].configure(bg=bg)
            parts["lbl"].configure(bg=bg)
            parts["actions"].configure(bg=bg)
        self._selected = idx
        if scroll:
            self._scroll_to_index(idx)

    def _scroll_to_index(self, idx):
        if idx < 0 or idx >= len(self._row_parts):
            return
        row = self._row_parts[idx]["row"]
        self.canvas.update_idletasks()
        y = row.winfo_y()
        h = row.winfo_height()
        ch = self.canvas.winfo_height()
        top = self.canvas.canvasy(0)
        bottom = top + ch
        if y < top:
            self.canvas.yview_moveto(max(0, y / max(1, self.inner.winfo_height())))
        elif y + h > bottom:
            self.canvas.yview_moveto(min(1, (y + h - ch) / max(1, self.inner.winfo_height())))

    def set_entries(self, entries):
        self._entries = list(entries)
        for parts in self._row_parts:
            parts["row"].destroy()
        self._row_parts.clear()
        self._hover_idx = None

        for idx, entry in enumerate(self._entries):
            row = tk.Frame(self.inner, bg=THEME_WHITE, height=self.ROW_H, cursor="hand2")
            row.pack(fill=tk.X, pady=1)
            row.pack_propagate(False)

            lbl = tk.Label(
                row,
                text=entry.get("_line") or format_history_line(entry),
                font=("Consolas", 9),
                anchor="w",
                bg=THEME_WHITE,
                fg=THEME_TEXT_PRIMARY,
                padx=6,
            )
            lbl.pack(side=tk.LEFT, fill=tk.X, expand=True)

            actions = tk.Frame(row, bg=THEME_WHITE)

            btn_edit = tk.Button(
                actions,
                text="✎",
                width=2,
                relief=tk.FLAT,
                bd=0,
                padx=4,
                pady=0,
                bg=THEME_ACCENT,
                fg=THEME_WHITE,
                activebackground=THEME_ACCENT_HOVER,
                activeforeground=THEME_WHITE,
                cursor="hand2",
                command=lambda e=entry: edit_history_entry(e),
            )
            btn_edit.pack(side=tk.LEFT, padx=1)
            btn_del = tk.Button(
                actions,
                text="✕",
                width=2,
                relief=tk.FLAT,
                bd=0,
                padx=4,
                pady=0,
                bg="#dc2626",
                fg=THEME_WHITE,
                activebackground="#b91c1c",
                activeforeground=THEME_WHITE,
                cursor="hand2",
                command=lambda e=entry: delete_history_entry(e),
            )
            btn_del.pack(side=tk.LEFT, padx=1)

            def bind_row(widget, i=idx, ent=entry):
                widget.bind("<Enter>", lambda e, j=i: self._on_row_enter(j))
                widget.bind("<Leave>", lambda e, j=i: self._on_row_leave(j))
                widget.bind("<Double-Button-1>", lambda e, en=ent: apply_history_to_form(en, focus_uren=True))
                widget.bind("<Button-1>", lambda e, j=i: self._select(j, scroll=False))

            for w in (row, lbl, actions, btn_edit, btn_del):
                bind_row(w)

            self._row_parts.append({"row": row, "lbl": lbl, "actions": actions})

        if self._entries:
            self._select(min(self._selected, len(self._entries) - 1), scroll=False)
        else:
            self._selected = 0
        self._on_inner_configure()

    def get_selected_index(self):
        return self._selected

    def get_selected_entry(self):
        if not self._entries or self._selected >= len(self._entries):
            return None
        return self._entries[self._selected]

    def focus_list(self):
        self.canvas.focus_set()
        if self._entries:
            self._select(0)

    def bind_keyboard(self, search_widget):
        self._search_widget = search_widget

        def on_up(event):
            if self._selected <= 0 and search_widget is not None:
                search_widget.focus_set()
                return "break"
            self._select(self._selected - 1)
            return "break"

        def on_down(event):
            self._select(self._selected + 1)
            return "break"

        def on_return(event):
            apply_selected_history()
            return "break"

        def on_edit(event):
            ent = self.get_selected_entry()
            if ent:
                edit_history_entry(ent)
            return "break"

        def on_delete(event):
            ent = self.get_selected_entry()
            if ent:
                delete_history_entry(ent)
            return "break"

        for seq, fn in (
            ("<Up>", on_up),
            ("<Down>", on_down),
            ("<Return>", on_return),
            ("<e>", on_edit),
            ("<E>", on_edit),
            ("<Delete>", on_delete),
        ):
            self.canvas.bind(seq, fn)
            self._wrap.bind(seq, fn)


def edit_history_entry(entry):
    """Bewerk een bestaande urenregel in Excel."""
    row_index = entry.get("row_index")
    if not row_index:
        messagebox.showerror("Fout", "Deze regel heeft geen Excel-referentie (ververs lijsten).")
        return

    pop = ctk.CTkToplevel(root)
    pop.title("Regel bewerken")
    pop.transient(root)
    pop.grab_set()
    pop.configure(fg_color=THEME_WHITE)
    pop.geometry("520x420")
    pop.minsize(480, 380)

    d = entry["datum"]
    v_datum = tk.StringVar(value=d.strftime("%Y-%m-%d") if isinstance(d, datetime) else str(d)[:10])
    v_og = tk.StringVar(value=entry.get("opdrachtgever", ""))
    v_proj = tk.StringVar(value=entry.get("project", ""))
    v_loc = tk.StringVar(value=entry.get("locatie", ""))
    v_wz = tk.StringVar(value=entry.get("werkzaamheden", ""))
    v_uren = tk.StringVar(value=f"{float(entry.get('uren', 0)):.1f}")
    v_tarief = tk.StringVar(value=str(entry.get("tarief", 0)))

    body = ctk.CTkFrame(pop, fg_color="transparent")
    body.pack(fill=tk.BOTH, expand=True, padx=SPACING_MD, pady=SPACING_MD)
    body.grid_columnconfigure(1, weight=1)

    fields = [
        ("Datum (YYYY-MM-DD)", v_datum),
        ("Opdrachtgever", v_og),
        ("Project", v_proj),
        ("Locatie", v_loc),
        ("Werkzaamheden", v_wz),
        ("Uren", v_uren),
        ("Tarief (€)", v_tarief),
    ]
    for r, (label, var) in enumerate(fields):
        desk.muted_label(body, text=label).grid(row=r, column=0, sticky="w", pady=4, padx=(0, 8))
        desk.standard_entry(body, textvariable=var).grid(row=r, column=1, sticky="ew", pady=4)

    btn_row = ctk.CTkFrame(pop, fg_color="transparent")
    btn_row.pack(fill=tk.X, padx=SPACING_MD, pady=(0, SPACING_MD))

    def save():
        opd = v_og.get().strip()
        proj = v_proj.get().strip()
        loc = v_loc.get().strip()
        werk = v_wz.get().strip()
        datum = v_datum.get().strip()
        try:
            uren = float(v_uren.get().replace(",", "."))
            tarief = float(v_tarief.get().replace(",", "."))
        except ValueError:
            messagebox.showerror("Fout", "Controleer uren en tarief.", parent=pop)
            return
        if not opd or not proj or not loc or not werk:
            messagebox.showerror("Fout", "Niet alle velden ingevuld.", parent=pop)
            return
        try:
            datetime.strptime(datum, "%Y-%m-%d")
        except ValueError:
            messagebox.showerror("Fout", "Datum ongeldig (YYYY-MM-DD).", parent=pop)
            return
        if update_entry_in_excel(row_index, datum, opd, proj, werk, loc, uren, tarief):
            pop.destroy()
            reload_lists_and_maps()

    desk.primary_button(btn_row, text="Opslaan", command=save).pack(side=tk.LEFT, padx=(0, SPACING_SM))
    desk.secondary_button(btn_row, text="Annuleren", command=pop.destroy).pack(side=tk.LEFT)
    pop.bind("<Return>", lambda e: save())
    pop.bind("<Escape>", lambda e: pop.destroy())
    pop.after(80, lambda: body.focus_set())


def delete_history_entry(entry):
    """Verwijder een urenregel uit Excel."""
    row_index = entry.get("row_index")
    if not row_index:
        messagebox.showerror("Fout", "Deze regel heeft geen Excel-referentie (ververs lijsten).")
        return
    if not messagebox.askyesno(
        "Regel verwijderen",
        f"Weet je zeker dat je deze regel wilt verwijderen?\n\n{format_history_line(entry)}",
    ):
        return
    if delete_entry_from_excel(row_index):
        reload_lists_and_maps()


def format_last_entry_line(tup):
    """Leesbare regel met datum, OG, project, locatie, werkzaamheden, uren, tarief."""
    if not tup or len(tup) < NUM_COLS:
        return ""
    d = tup[COL_DATUM - 1]
    if isinstance(d, datetime):
        ds = d.strftime("%Y-%m-%d")
    else:
        ds = str(d)[:10] if d else ""
    og = tup[COL_OPDRACHTGEVER - 1] or ""
    pr = tup[COL_PROJECT - 1] or ""
    loc = tup[COL_LOCATIE - 1] or ""
    wz = (tup[COL_WERKZAAMHEDEN - 1] or "")[:40]
    ur = tup[COL_UREN - 1]
    tr = tup[COL_TARIEF - 1]
    return f"{ds} | {og} | {pr} | {loc} | {wz} | {ur} u × €{tr}"


def _prepare_history_entry_cache(entry):
    """Eenmalig zoek- en weergavetekst cachen (snelle filter)."""
    if not entry.get("_search"):
        d = entry["datum"]
        ds = d.strftime("%Y-%m-%d") if isinstance(d, datetime) else str(d)[:10]
        entry["_search"] = " ".join(
            [
                ds,
                entry.get("opdrachtgever", ""),
                entry.get("project", ""),
                entry.get("locatie", ""),
                entry.get("werkzaamheden", ""),
            ]
        ).lower()
    if not entry.get("_line"):
        entry["_line"] = format_history_line(entry)
    return entry["_search"]


def _filter_history_entries(query):
    """Filter historie; retourneert (getoonde rijen, totaal/getoonde count, heeft_meer flag)."""
    q = (query or "").strip().lower()
    all_hist = _invoer_intel.get("history", [])
    if not q:
        shown = all_hist[:HISTORY_DISPLAY_LIMIT]
        total = len(all_hist)
        return shown, total, max(0, total - len(shown))

    shown = []
    has_more = False
    for entry in all_hist:
        hay = entry.get("_search") or _prepare_history_entry_cache(entry)
        if q not in hay:
            continue
        if len(shown) < HISTORY_DISPLAY_LIMIT:
            shown.append(entry)
        else:
            has_more = True
            break
    total = len(shown) + (1 if has_more else 0)
    return shown, total, 1 if has_more else 0


def schedule_refresh_history_list():
    """Debounce: wacht even na typen voordat lijst opnieuw opgebouwd wordt."""
    if history_scroll_list is None or root is None:
        return
    if _history_filter_after[0] is not None:
        try:
            root.after_cancel(_history_filter_after[0])
        except tk.TclError:
            pass
    _history_filter_after[0] = root.after(HISTORY_SEARCH_DEBOUNCE_MS, refresh_history_list)


def _update_history_status(shown_count, total_matched, extra_hidden, query):
    if history_status_lbl is None:
        return
    q = (query or "").strip()
    if not total_matched:
        history_status_lbl.configure(
            text="Geen resultaten" + (f" voor '{q}'" if q else ""),
        )
    elif extra_hidden:
        history_status_lbl.configure(
            text=f"{shown_count}+ resultaten — verfijn zoekopdracht",
        )
    elif q:
        history_status_lbl.configure(text=f"{total_matched} resultaten")
    else:
        history_status_lbl.configure(
            text=f"{total_matched} recente regels" if total_matched <= HISTORY_DISPLAY_LIMIT
            else f"{shown_count} meest recente van {total_matched} regels",
        )


def refresh_history_list():
    global _history_display, _history_filter_after
    _history_filter_after[0] = None
    if history_scroll_list is None:
        return
    q = history_search_var.get() if history_search_var else ""
    filtered, total_matched, extra = _filter_history_entries(q)
    _history_display = filtered
    prev_key = getattr(history_scroll_list, "_visible_key", None)
    new_key = tuple(e.get("row_index") for e in filtered)
    if new_key != prev_key:
        history_scroll_list.set_entries(filtered)
        history_scroll_list._visible_key = new_key
        if filtered:
            history_scroll_list._select(0, scroll=False)
    _update_history_status(len(filtered), total_matched, extra, q)


def apply_history_to_form(entry, focus_uren=False):
    """Neem historische regel over naar vandaag (datum blijft huidige invoerdatum)."""
    opdrachtgever_var.set(entry.get("opdrachtgever", ""))
    project_var.set(entry.get("project", ""))
    locatie_var.set(entry.get("locatie", ""))
    wz = entry.get("werkzaamheden", "")
    if werkzaamheden_var is not None:
        werkzaamheden_var.set(wz)
    elif werkzaamheden_entry is not None:
        werkzaamheden_entry.delete(0, tk.END)
        werkzaamheden_entry.insert(0, wz)
    uren_var.set(f"{float(entry.get('uren', 1.0)):.1f}")
    tarief_var.set(str(entry.get("tarief", 0.0)))
    apply_tarief_to_field()
    update_selection_label()
    if focus_uren and werkzaamheden_entry is not None:
        werkzaamheden_entry.focus_set()


def apply_selected_history():
    if history_scroll_list is None or not _history_display:
        return
    entry = history_scroll_list.get_selected_entry()
    if entry:
        apply_history_to_form(entry, focus_uren=True)


def open_werkzaamheden_popup():
    """Open lijst met recente omschrijvingen voor huidige context."""
    if werkzaamheden_entry is None:
        return
    opts = smart_werkzaamheden()
    if not opts:
        return
    pop = ctk.CTkToplevel(root)
    pop.wm_title("")
    pop.transient(root)
    pop.configure(fg_color=THEME_WHITE)
    x = werkzaamheden_entry.winfo_rootx()
    y = werkzaamheden_entry.winfo_rooty() + werkzaamheden_entry.winfo_height()
    pop.geometry("+%d+%d" % (x, y))
    pop.attributes("-topmost", True)
    outer = ctk.CTkFrame(pop, fg_color=THEME_WHITE, corner_radius=desk.RADIUS["md"], border_width=1, border_color=THEME_BORDER)
    outer.pack(fill=tk.BOTH, expand=True, padx=2, pady=2)
    search_var = tk.StringVar(value=werkzaamheden_var.get())
    e_search = desk.standard_entry(outer, textvariable=search_var, width=360)
    e_search.pack(fill=tk.X, padx=SPACING_SM, pady=SPACING_SM)
    inner = tk.Frame(outer, bg=THEME_WHITE)
    inner.pack(fill=tk.BOTH, expand=True, padx=SPACING_SM, pady=(0, SPACING_SM))
    lb = tk.Listbox(
        inner,
        height=min(12, len(opts)),
        width=48,
        font=FONT_UI,
        exportselection=False,
        bg=THEME_WHITE,
        fg=THEME_TEXT_PRIMARY,
        selectbackground=THEME_ACCENT_LIGHT,
        selectforeground=THEME_ACCENT,
    )
    scroll = ttk.Scrollbar(inner, orient=tk.VERTICAL, command=lb.yview)
    lb.configure(yscrollcommand=scroll.set)
    scroll.pack(side=tk.RIGHT, fill=tk.Y)
    lb.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

    def fill_list(items):
        lb.delete(0, tk.END)
        for o in items:
            lb.insert(tk.END, o)
        if items:
            lb.selection_set(0)

    def on_filter(*_a):
        q = search_var.get().lower().strip()
        items = [o for o in opts if not q or q in o.lower()]
        items.sort(key=lambda o: _search_rank(o, q))
        fill_list(items)

    def pick(*_e):
        sel = lb.curselection()
        if sel:
            werkzaamheden_var.set(lb.get(sel[0]))
        pop.destroy()

    search_var.trace_add("write", lambda *_: on_filter())
    lb.bind("<Double-1>", pick)
    lb.bind("<Return>", pick)
    e_search.bind("<Return>", pick)
    e_search.bind("<Escape>", lambda e: pop.destroy())
    on_filter()
    pop.after(10, e_search.focus_set())


def _cascade_invoer_fields():
    """Vul lege velden automatisch aan op basis van klant+project (+ locatie)."""
    og = opdrachtgever_var.get().strip()
    proj = project_var.get().strip()
    loc = locatie_var.get().strip()
    apply_tarief_to_field()
    if og and proj:
        combo = _invoer_intel["last_combo"].get((og, proj))
        if combo:
            if not locatie_var.get().strip() and combo.get("locatie"):
                locatie_var.set(combo["locatie"])
                loc = combo["locatie"]
            wz_current = werkzaamheden_var.get().strip() if werkzaamheden_var else (
                werkzaamheden_entry.get().strip() if werkzaamheden_entry else ""
            )
            if not wz_current and combo.get("werkzaamheden"):
                if werkzaamheden_var is not None:
                    werkzaamheden_var.set(combo["werkzaamheden"])
                elif werkzaamheden_entry is not None:
                    werkzaamheden_entry.delete(0, tk.END)
                    werkzaamheden_entry.insert(0, combo["werkzaamheden"])
    if og and proj and loc:
        wz_current = werkzaamheden_var.get().strip() if werkzaamheden_var else (
            werkzaamheden_entry.get().strip() if werkzaamheden_entry else ""
        )
        if not wz_current:
            recent_werk = _sort_context_values(_invoer_intel["werk_by_context"], (og, proj, loc))
            if recent_werk:
                if werkzaamheden_var is not None:
                    werkzaamheden_var.set(recent_werk[0])
                elif werkzaamheden_entry is not None:
                    werkzaamheden_entry.delete(0, tk.END)
                    werkzaamheden_entry.insert(0, recent_werk[0])
    update_selection_label()


# ====== TARIEF LOGICA ======
def guess_tarief(opd, proj):
    opd = (opd or "").strip()
    proj = (proj or "").strip()
    if opd and proj and (opd, proj) in tarieven_pair:
        return tarieven_pair[(opd, proj)]
    if proj and proj in last_by_project:
        return last_by_project[proj]
    if opd and opd in last_by_opdrachtgever:
        return last_by_opdrachtgever[opd]
    return None


def apply_tarief_to_field():
    t = guess_tarief(opdrachtgever_var.get(), project_var.get())
    if t is not None:
        tarief_var.set(str(t))
    else:
        tarief_var.set("0.0")


def reload_lists_and_maps():
    global opdrachtgevers, projecten, locaties, tarieven_pair, last_by_project, last_by_opdrachtgever
    sync_excel_workbook_if_open(EXCEL_PATH)
    (
        opdrachtgevers,
        projecten,
        locaties,
        tarieven_pair,
        last_by_project,
        last_by_opdrachtgever,
        _lo,
        _lp,
        _ll,
    ) = load_existing_data()
    refresh_comboboxes()
    refresh_history_list()
    update_invoer_stats()
    if _uren_current_tab[0] == 1:
        run_projecten()


def refresh_comboboxes():
    """Lijsten komen uit lambda bij openen van zoek-popup; alleen tarief/summary bijwerken."""
    apply_tarief_to_field()
    update_selection_label()
    _cascade_invoer_fields()


def update_recent_list(lst, val):
    if val in lst:
        lst.remove(val)
    lst.insert(0, val)


def add_new_value(target_list, var, title, dd_wrap):
    new_val = simpledialog.askstring("Nieuwe waarde", f"Voer nieuwe {title} in:")
    if new_val and new_val.strip():
        v = new_val.strip()
        update_recent_list(target_list, v)
        dd_wrap.set(v)
        apply_tarief_to_field()
        update_selection_label()


def update_total_label(*args):
    try:
        uren = float(uren_var.get().replace(",", "."))
        tarief = float(tarief_var.get().replace(",", "."))
        totaal_var.set(f"€ {uren * tarief:.2f}")
    except (ValueError, TypeError):
        totaal_var.set("€ -")


def add_entry():
    opd = opdrachtgever_var.get().strip()
    proj = project_var.get().strip()
    loc = locatie_var.get().strip()
    werk = (werkzaamheden_var.get() if werkzaamheden_var else werkzaamheden_entry.get()).strip()
    datum = datum_var.get()

    try:
        uren = float(uren_var.get().replace(",", "."))
        tarief = float(tarief_var.get().replace(",", "."))
    except ValueError:
        messagebox.showerror("Fout", "Controleer uren en tarief.")
        return

    if not opd or not proj or not loc or not werk:
        messagebox.showerror("Fout", "Niet alle velden ingevuld.")
        return

    try:
        datetime.strptime(datum, "%Y-%m-%d")
    except ValueError:
        messagebox.showerror("Fout", "Datum ongeldig formaat (YYYY-MM-DD).")
        return

    rows = load_hours_rows()
    similar = find_similar_entries(rows, datum, opd, proj, uren)
    if similar:
        n = len(similar)
        sample = similar[0]
        ds = sample["datum"].strftime("%Y-%m-%d") if isinstance(sample.get("datum"), datetime) else str(sample.get("datum", ""))[:10]
        msg = (
            f"Er {'staat al' if n == 1 else f'staan al {n}'} een vergelijkbare regel{'s' if n > 1 else ''} "
            f"op deze dag ({ds} · {sample.get('opdrachtgever')} · {sample.get('project')} · {sample.get('uren')} u).\n\nToch opslaan?"
        )
        if not messagebox.askyesno("Vergelijkbare regel", msg):
            return

    if not add_entry_to_excel(datum, opd, proj, werk, loc, uren, tarief):
        return

    update_recent_list(opdrachtgevers, opd)
    update_recent_list(projecten, proj)
    update_recent_list(locaties, loc)
    tarieven_pair[(opd, proj)] = tarief
    last_by_project[proj] = tarief
    last_by_opdrachtgever[opd] = tarief
    reload_lists_and_maps()

    reset_fields(opd, proj, loc)
    _invoer_focus_widget(werkzaamheden_entry)


def reset_fields(last_opd=None, last_proj=None, last_loc=None):
    if last_opd:
        opdrachtgever_var.set(last_opd)
    if last_proj:
        project_var.set(last_proj)
    if last_loc:
        locatie_var.set(last_loc)

    werkzaamheden_var.set("")
    uren_var.set("1.0")
    apply_tarief_to_field()
    datum_var.set(datetime.today().strftime("%Y-%m-%d"))
    update_selection_label()


def adjust_date(days):
    try:
        dt = datetime.strptime(datum_var.get(), "%Y-%m-%d")
    except ValueError:
        dt = datetime.today()
    dt += timedelta(days=days)
    datum_var.set(dt.strftime("%Y-%m-%d"))


def adjust_hours(delta):
    try:
        uren = float(uren_var.get().replace(",", "."))
    except ValueError:
        uren = 1.0
    uren += delta
    if uren < 0.5:
        uren = 0.5
    uren_var.set(f"{uren:.1f}")


def _entry_as_date(entry):
    d = entry.get("datum")
    if isinstance(d, datetime):
        return d.date()
    if d is None:
        return None
    try:
        if hasattr(d, "year") and hasattr(d, "month") and hasattr(d, "day"):
            return datetime(int(d.year), int(d.month), int(d.day)).date()
    except (TypeError, ValueError):
        pass
    try:
        return datetime.strptime(str(d)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _hours_for_selected_period(datum_str=None):
    """Tel uren op geselecteerde dag en bijbehorende ISO-week."""
    if datum_str is None:
        datum_str = datum_var.get() if datum_var else ""
    try:
        sel = datetime.strptime((datum_str or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        sel = datetime.today().date()
    day_h = 0.0
    week_h = 0.0
    week_no = sel.isocalendar()[1]
    week_year = sel.isocalendar()[0]
    for entry in _invoer_intel.get("history", []):
        ed = _entry_as_date(entry)
        if ed is None:
            continue
        ur = float(entry.get("uren", 0) or 0)
        if ed == sel:
            day_h += ur
        iso = ed.isocalendar()
        if iso[0] == week_year and iso[1] == week_no:
            week_h += ur
    return sel, day_h, week_h, week_no


def update_invoer_stats():
    if lbl_invoer_day_stats is None or lbl_invoer_week_stats is None:
        return
    try:
        sel, day_h, week_h, week_no = _hours_for_selected_period()
    except Exception:
        return
    lbl_invoer_day_stats.configure(text=f"{day_h:.1f} u")
    lbl_invoer_week_stats.configure(text=f"{week_h:.1f} u (week {week_no})")


def refresh_last_entries():
    refresh_history_list()


def open_excel():
    """Open het urenbestand in Excel. Gebruikt absoluut pad + COM (betrouwbaarder met OneDrive)."""
    path = os.path.normpath(os.path.abspath(EXCEL_PATH))
    if not os.path.isfile(path):
        messagebox.showerror(
            "Bestand niet gevonden",
            f"Er staat geen bestand op deze locatie:\n\n{path}\n\n"
            "Controleer EXCEL_PATH bovenaan uren_app.py en of OneDrive klaar is met synchroniseren.",
        )
        return
    try:
        import win32com.client
        xl = win32com.client.Dispatch("Excel.Application")
        xl.Visible = True
        n = int(xl.Workbooks.Count)
        for i in range(1, n + 1):
            try:
                wb = xl.Workbooks(i)
                full = str(wb.FullName)
                if _paths_same_excel_workbook(full, path):
                    wb.Activate()
                    return
            except Exception:
                continue
        xl.Workbooks.Open(path, UpdateLinks=0, ReadOnly=False)
        sync_excel_workbook_if_open(path)
    except Exception as com_err:
        try:
            os.startfile(path)
        except Exception as e2:
            messagebox.showerror(
                "Fout",
                f"Kon Excel niet openen.\n\n"
                f"COM: {com_err}\n\n"
                f"Startfile: {e2}\n\n"
                f"Pad:\n{path}",
            )


def update_selection_label(*args):
    if sel_lbl is None:
        return
    try:
        if not sel_lbl.winfo_exists():
            return
    except tk.TclError:
        return
    sel_lbl.configure(
        text=(
            f"{opdrachtgever_var.get() or '—'}  ·  {project_var.get() or '—'}  ·  {locatie_var.get() or '—'}"
            f"  ·  tarief €{tarief_var.get() or '—'}"
            "  ·  Tab/Enter = volgende/aanvullen  ·  Enter = opslaan  ·  ↑↓ uren ±½  ·  Ctrl+Enter = opslaan"
        )
    )


# ====== ROOT (StringVar’s hebben een Tk-master nodig) ======
ctk.set_appearance_mode("light")
root = ctk.CTk()
root.title("IMeTech Urenadministratie")
root.geometry("1080x760")
root.minsize(920, 680)
root.configure(fg_color=THEME_WHITE)
desk.apply_window_icon(root, desk.resolve_icon_path("uren_app.ico", _APP_DIR))
root.grid_columnconfigure(2, weight=1)
root.grid_rowconfigure(0, weight=1)

sidebar = ctk.CTkFrame(
    root,
    width=SIDEBAR_WIDTH,
    corner_radius=0,
    fg_color=THEME_BG,
)
sidebar.grid(row=0, column=0, sticky="nsew")
sidebar.grid_propagate(False)

sep = tk.Frame(root, bg=THEME_BORDER, width=1, highlightthickness=0)
sep.grid(row=0, column=1, sticky="ns")

content = ctk.CTkFrame(root, fg_color=THEME_BG, corner_radius=0)
content.grid(row=0, column=2, sticky="nsew")
content.grid_columnconfigure(0, weight=1)
content.grid_rowconfigure(0, weight=1)

# ====== ANALYSE TAB ======
_analyse_rows = []
_analyse_og_buttons = []
_analyse_proj_buttons = []
_analyse_tarief_buttons = []
selected_ogs = set()
selected_projs = set()
selected_tarieven = set()
selected_tarieven_non_zero = False
period_mode = tk.StringVar(value="alles")
custom_year = tk.IntVar(value=datetime.today().year)
custom_month = tk.IntVar(value=datetime.today().month)
custom_week_year = tk.IntVar(value=datetime.today().year)
custom_week = tk.IntVar(value=datetime.today().isocalendar()[1])
group_mode = tk.StringVar(value="none")
keyword_var = tk.StringVar()
period_btns = {}
frm_og_chips = frm_proj_chips = frm_tarief_chips = None
frm_custom = frm_week_custom = None
tree = None
tree_locatie = None
lbl_summary = None
_analyse_chart_cv = None
_analyse_chart_var = None
_analyse_chart_year = None
_analyse_chart_euro = None

_project_rows = []
_project_status_buttons = []
_selected_project_statuses = set()
_project_search_var = None
_project_summary_lbl = None
_project_tree = None
_frm_project_status_chips = None


def _period_bounds():
    today = datetime.today().date()
    mode = period_mode.get()
    if mode == "alles":
        return None, None
    if mode == "week":
        d = today
        start = d - timedelta(days=d.weekday())
        end = start + timedelta(days=6)
    elif mode == "month":
        start = today.replace(day=1)
        if start.month == 12:
            end = start.replace(year=start.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            end = start.replace(month=start.month + 1, day=1) - timedelta(days=1)
    elif mode == "year":
        start = today.replace(month=1, day=1)
        end = today.replace(month=12, day=31)
    elif mode == "custom_month":
        y, m = custom_year.get(), custom_month.get()
        start = datetime(y, m, 1).date()
        if m == 12:
            end = datetime(y + 1, 1, 1).date() - timedelta(days=1)
        else:
            end = datetime(y, m + 1, 1).date() - timedelta(days=1)
    elif mode == "custom_week":
        y, w = custom_week_year.get(), custom_week.get()
        try:
            start = datetime.fromisocalendar(y, w, 1).date()
            end = datetime.fromisocalendar(y, w, 7).date()
        except ValueError:
            start, end = today, today
    else:
        return None, None
    return start, end


def _filter_rows(rows):
    start, end = _period_bounds()
    kw = (keyword_var.get() or "").strip().lower()
    out = []
    for r in rows:
        if selected_ogs and r["opdrachtgever"] not in selected_ogs:
            continue
        if selected_projs and r["project"] not in selected_projs:
            continue
        tr = round(r["tarief"], 4)
        if selected_tarieven_non_zero and tr == 0:
            continue
        if selected_tarieven:
            if tr not in selected_tarieven:
                continue
        d = r["datum"].date() if isinstance(r["datum"], datetime) else r["datum"]
        if start is not None and (d < start or d > end):
            continue
        if kw and kw not in r["werkzaamheden"].lower():
            continue
        out.append(r)
    return out


def _filter_rows_for_charts(rows):
    """OG/project/tarief/keyword — no analyse period limit."""
    kw = (keyword_var.get() or "").strip().lower()
    out = []
    for r in rows:
        if selected_ogs and r["opdrachtgever"] not in selected_ogs:
            continue
        if selected_projs and r["project"] not in selected_projs:
            continue
        tr = round(r["tarief"], 4)
        if selected_tarieven_non_zero and tr == 0:
            continue
        if selected_tarieven:
            if tr not in selected_tarieven:
                continue
        if kw and kw not in r["werkzaamheden"].lower():
            continue
        out.append(r)
    return out


def run_analyse():
    global _analyse_rows
    _analyse_rows = load_hours_rows()
    _rebuild_filter_chips()
    _apply_analyse_filters()


def _aggregate_filter_usage(rows, field):
    """Tel uren, aantal regels en laatste datum per filterwaarde."""
    stats = defaultdict(lambda: {"uren": 0.0, "count": 0, "last": None})
    for r in rows:
        if field == "tarief":
            val = round(r["tarief"], 4)
        else:
            val = (r.get(field) or "").strip()
            if not val:
                continue
        stats[val]["uren"] += r["uren"]
        stats[val]["count"] += 1
        d = r["datum"]
        if stats[val]["last"] is None or d > stats[val]["last"]:
            stats[val]["last"] = d
    return stats


def _sort_filter_values_by_usage(rows, field):
    """Meest gebruikt vooraan: uren, dan aantal regels, dan recentste datum."""
    stats = _aggregate_filter_usage(rows, field)
    if not stats:
        return []

    def sort_key(val):
        s = stats[val]
        last = s["last"] or datetime.min
        name_key = val.lower() if isinstance(val, str) else val
        return (-s["uren"], -s["count"], -last.timestamp(), name_key)

    return sorted(stats.keys(), key=sort_key)


def _rebuild_filter_chips():
    global selected_tarieven_non_zero
    ogs = _sort_filter_values_by_usage(_analyse_rows, "opdrachtgever")
    projs = _sort_filter_values_by_usage(_analyse_rows, "project")
    trs = _sort_filter_values_by_usage(_analyse_rows, "tarief")

    for b in _analyse_og_buttons:
        b.destroy()
    _analyse_og_buttons.clear()
    for b in _analyse_proj_buttons:
        b.destroy()
    _analyse_proj_buttons.clear()
    for b in _analyse_tarief_buttons:
        b.destroy()
    _analyse_tarief_buttons.clear()

    def og_click(name):
        if name is None:
            selected_ogs.clear()
        elif name in selected_ogs:
            selected_ogs.discard(name)
        else:
            selected_ogs.add(name)
        _style_chip_row_og(_analyse_og_buttons)
        _rebuild_project_chips()
        _apply_analyse_filters()

    def mk_og(parent, text, val):
        btn = ctk.CTkButton(
            parent,
            text=text,
            height=28,
            font=desk.font_body(11),
            corner_radius=desk.RADIUS["md"],
            fg_color=THEME_WHITE,
            text_color=THEME_TEXT_PRIMARY,
            hover_color=THEME_BG_HOVER,
            border_width=1,
            border_color=THEME_BORDER,
        )
        btn._og_val = val
        if val is None:
            btn._og_val = None
        btn.configure(command=lambda v=val: og_click(v))
        btn.pack(side=tk.LEFT, padx=2, pady=2)
        _analyse_og_buttons.append(btn)

    mk_og(frm_og_chips, "Alles", None)
    for og in ogs:
        mk_og(frm_og_chips, og, og)
    _style_chip_row_og(_analyse_og_buttons)

    _rebuild_project_chips_inner(projs)

    def tr_click(t):
        global selected_tarieven_non_zero
        selected_tarieven_non_zero = False
        if t in selected_tarieven:
            selected_tarieven.discard(t)
        else:
            selected_tarieven.add(t)
        _style_tarief_chips()
        _apply_analyse_filters()

    def tr_click_all():
        global selected_tarieven_non_zero
        selected_tarieven.clear()
        selected_tarieven_non_zero = False
        _style_tarief_chips()
        _apply_analyse_filters()

    def tr_click_non_zero():
        global selected_tarieven_non_zero
        selected_tarieven.clear()
        selected_tarieven_non_zero = not selected_tarieven_non_zero
        _style_tarief_chips()
        _apply_analyse_filters()

    btn_all = ctk.CTkButton(
        frm_tarief_chips,
        text="Alles",
        height=28,
        font=desk.font_body(11),
        corner_radius=desk.RADIUS["md"],
        fg_color=THEME_WHITE,
        text_color=THEME_TEXT_PRIMARY,
        hover_color=THEME_BG_HOVER,
        border_width=1,
        border_color=THEME_BORDER,
    )
    btn_all._tarief_val = None
    btn_all.configure(command=tr_click_all)
    btn_all.pack(side=tk.LEFT, padx=2, pady=2)
    _analyse_tarief_buttons.append(btn_all)

    btn_non_zero = ctk.CTkButton(
        frm_tarief_chips,
        text="Alles behalve 0",
        height=28,
        font=desk.font_body(11),
        corner_radius=desk.RADIUS["md"],
        fg_color=THEME_WHITE,
        text_color=THEME_TEXT_PRIMARY,
        hover_color=THEME_BG_HOVER,
        border_width=1,
        border_color=THEME_BORDER,
    )
    btn_non_zero._tarief_val = "__non_zero__"
    btn_non_zero.configure(command=tr_click_non_zero)
    btn_non_zero.pack(side=tk.LEFT, padx=2, pady=2)
    _analyse_tarief_buttons.append(btn_non_zero)

    for t in trs:
        lbl = f"€{t:g}" if t == int(t) else f"€{t:.2f}"
        btn = ctk.CTkButton(
            frm_tarief_chips,
            text=lbl,
            height=28,
            font=desk.font_body(11),
            corner_radius=desk.RADIUS["md"],
            fg_color=THEME_WHITE,
            text_color=THEME_TEXT_PRIMARY,
            hover_color=THEME_BG_HOVER,
            border_width=1,
            border_color=THEME_BORDER,
        )
        btn._tarief_val = t
        btn.configure(command=lambda x=t: tr_click(x))
        btn.pack(side=tk.LEFT, padx=2, pady=2)
        _analyse_tarief_buttons.append(btn)
    _style_tarief_chips()


def _style_chip_row_og(buttons):
    for btn in buttons:
        val = btn._og_val
        if val is None:
            is_sel = len(selected_ogs) == 0
        else:
            is_sel = val in selected_ogs
        if is_sel:
            btn.configure(
                fg_color=THEME_ACCENT_LIGHT,
                text_color=THEME_ACCENT,
                hover_color=THEME_ACCENT_LIGHT,
                border_color=THEME_ACCENT_LIGHT,
            )
        else:
            btn.configure(
                fg_color=THEME_WHITE,
                text_color=THEME_TEXT_PRIMARY,
                hover_color=THEME_BG_HOVER,
                border_color=THEME_BORDER,
            )


def _style_chip_row_proj(buttons):
    for btn in buttons:
        val = btn._proj_val
        if val is None:
            is_sel = len(selected_projs) == 0
        else:
            is_sel = val in selected_projs
        if is_sel:
            btn.configure(
                fg_color=THEME_ACCENT_LIGHT,
                text_color=THEME_ACCENT,
                hover_color=THEME_ACCENT_LIGHT,
                border_color=THEME_ACCENT_LIGHT,
            )
        else:
            btn.configure(
                fg_color=THEME_WHITE,
                text_color=THEME_TEXT_PRIMARY,
                hover_color=THEME_BG_HOVER,
                border_color=THEME_BORDER,
            )


def _style_tarief_chips():
    for btn in _analyse_tarief_buttons:
        t = btn._tarief_val
        if t is None:
            is_sel = (len(selected_tarieven) == 0) and (not selected_tarieven_non_zero)
        elif t == "__non_zero__":
            is_sel = selected_tarieven_non_zero
        else:
            is_sel = t in selected_tarieven
        if is_sel:
            btn.configure(
                fg_color=THEME_ACCENT_LIGHT,
                text_color=THEME_ACCENT,
                hover_color=THEME_ACCENT_LIGHT,
                border_color=THEME_ACCENT_LIGHT,
            )
        else:
            btn.configure(
                fg_color=THEME_WHITE,
                text_color=THEME_TEXT_PRIMARY,
                hover_color=THEME_BG_HOVER,
                border_color=THEME_BORDER,
            )


def _rebuild_project_chips():
    rows = [
        r
        for r in _analyse_rows
        if r["project"] and (not selected_ogs or r["opdrachtgever"] in selected_ogs)
    ]
    projs = _sort_filter_values_by_usage(rows, "project")
    for b in _analyse_proj_buttons:
        b.destroy()
    _analyse_proj_buttons.clear()
    _rebuild_project_chips_inner(projs)


def _rebuild_project_chips_inner(projs):
    def proj_click(name):
        if name is None:
            selected_projs.clear()
        elif name in selected_projs:
            selected_projs.discard(name)
        else:
            selected_projs.add(name)
        _style_chip_row_proj(_analyse_proj_buttons)
        _apply_analyse_filters()

    def mk_proj(text, val):
        btn = ctk.CTkButton(
            frm_proj_chips,
            text=text,
            height=28,
            font=desk.font_body(11),
            corner_radius=desk.RADIUS["md"],
            fg_color=THEME_WHITE,
            text_color=THEME_TEXT_PRIMARY,
            hover_color=THEME_BG_HOVER,
            border_width=1,
            border_color=THEME_BORDER,
        )
        btn._proj_val = val
        btn.configure(command=lambda v=val: proj_click(v))
        btn.pack(side=tk.LEFT, padx=2, pady=2)
        _analyse_proj_buttons.append(btn)

    mk_proj("Alles", None)
    for p in projs:
        mk_proj(p, p)
    _style_chip_row_proj(_analyse_proj_buttons)


def _truncate_omschrijving(text, max_len=72):
    t = (text or "").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


def _apply_analyse_filters():
    if tree is None or lbl_summary is None:
        return
    tree.delete(*tree.get_children())
    rows = _filter_rows(_analyse_rows)
    gmode = group_mode.get()

    if gmode == "none":
        tree.heading("c5", text="Tarief €/u")
    elif gmode in ("week", "month", "opdrachtgever"):
        tree.heading("c5", text="€/u (effectief)")
    else:
        tree.heading("c5", text="Tarief €/u")

    tot_u = 0.0
    tot_e = 0.0

    if gmode == "none":
        for r in sorted(rows, key=lambda x: x["datum"]):
            tot_u += r["uren"]
            tot_e += r["bedrag"]
            tree.insert(
                "",
                tk.END,
                values=(
                    r["datum"].strftime("%Y-%m-%d") if isinstance(r["datum"], datetime) else str(r["datum"]),
                    r["opdrachtgever"],
                    r["project"],
                    r["locatie"],
                    f"{r['uren']:.2f}",
                    f"{r['tarief']:.2f}",
                    f"{r['bedrag']:.2f}",
                    _truncate_omschrijving(r.get("werkzaamheden", "")),
                ),
            )
    else:
        def _uniform_or_blank(values):
            return next(iter(values)) if len(values) == 1 else ""

        groups = {}
        for r in rows:
            if gmode == "project":
                p = r["project"] or "(geen project)"
                tkey = round(float(r["tarief"]), 4)
                k = ("pr", p, tkey)
            elif gmode == "opdrachtgever":
                og = r["opdrachtgever"] or "(geen opdrachtgever)"
                k = ("og", og)
            elif gmode == "week":
                iso = r["datum"].isocalendar()
                k = ("wk", iso[0], iso[1])
            elif gmode == "month":
                d = r["datum"]
                k = ("mo", d.year, d.month)
            else:
                k = ("",)
            if k not in groups:
                groups[k] = {
                    "uren": 0.0,
                    "bedrag": 0.0,
                    "n": 0,
                    "days": set(),
                    "opdrachtgevers": set(),
                    "projecten": set(),
                    "locaties": set(),
                }
            groups[k]["uren"] += r["uren"]
            groups[k]["bedrag"] += r["bedrag"]
            groups[k]["n"] += 1
            rd = r["datum"].date() if isinstance(r["datum"], datetime) else r["datum"]
            groups[k]["days"].add(rd)
            groups[k]["opdrachtgevers"].add(r["opdrachtgever"] or "")
            groups[k]["projecten"].add(r["project"] or "")
            groups[k]["locaties"].add(r["locatie"] or "")

        def _sort_keys(klist):
            if gmode == "project":
                return sorted(klist, key=lambda x: (x[1].lower(), x[2]))
            if gmode == "opdrachtgever":
                return sorted(klist, key=lambda x: x[1].lower())
            if gmode == "week":
                return sorted(klist, key=lambda x: (x[1], x[2]))
            if gmode == "month":
                return sorted(klist, key=lambda x: (x[1], x[2]))
            return sorted(klist)

        for k in _sort_keys(list(groups.keys())):
            g = groups[k]
            tot_u += g["uren"]
            tot_e += g["bedrag"]
            n = g["n"]
            dagen = len(g["days"])
            oms_grp = f"({n} regels, {dagen} dagen)" if n else "\u2014"
            if gmode == "project":
                label = f"{k[1]}  \u00b7  \u20ac{k[2]:.2f}/u"
                tar_s = f"{k[2]:.2f}"
            elif gmode == "opdrachtgever":
                label = k[1]
                eff = (g["bedrag"] / g["uren"]) if g["uren"] > 0 else 0.0
                tar_s = f"{eff:.2f}"
            elif gmode == "week":
                label = f"{k[1]} W{k[2]:02d}"
                eff = (g["bedrag"] / g["uren"]) if g["uren"] > 0 else 0.0
                tar_s = f"{eff:.2f}"
            else:
                label = f"{k[1]}-{k[2]:02d}"
                eff = (g["bedrag"] / g["uren"]) if g["uren"] > 0 else 0.0
                tar_s = f"{eff:.2f}"
            group_og = _uniform_or_blank(g["opdrachtgevers"])
            group_proj = _uniform_or_blank(g["projecten"])
            group_loc = _uniform_or_blank(g["locaties"])
            tree.insert(
                "",
                tk.END,
                values=(label, group_og, group_proj, group_loc, f"{g['uren']:.2f}", tar_s, f"{g['bedrag']:.2f}", oms_grp),
            )

    loc_stats = defaultdict(lambda: {"days": set(), "uren": 0.0, "bedrag": 0.0})
    all_days = set()
    for r in rows:
        d = r["datum"].date() if isinstance(r["datum"], datetime) else r["datum"]
        loc = r["locatie"] or "(geen locatie)"
        loc_stats[loc]["days"].add(d)
        loc_stats[loc]["uren"] += r["uren"]
        loc_stats[loc]["bedrag"] += r["bedrag"]
        all_days.add(d)

    if tree_locatie is not None:
        tree_locatie.delete(*tree_locatie.get_children())
        for loc in sorted(loc_stats.keys()):
            s = loc_stats[loc]
            tree_locatie.insert(
                "",
                tk.END,
                values=(loc, len(s["days"]), f"{s['uren']:.2f}", f"{s['bedrag']:.2f}"),
            )

    total_unique_days = len(all_days)
    lbl_summary.configure(
        text=f"Totaal uren: {tot_u:.2f}  |  Totaal \u20ac (excl. BTW): {tot_e:.2f}  |  Dagen: {total_unique_days}  |  Regels: {len(rows)}"
    )
    if _uren_current_tab[0] == 3:
        _refresh_grafieken_chart()


def _filter_project_rows(rows):
    q = (_project_search_var.get() if _project_search_var else "").strip().lower()
    out = []
    for r in rows:
        if _selected_project_statuses and r.get("status") not in _selected_project_statuses:
            continue
        if q:
            hay = f"{r.get('project', '')} {r.get('opdrachtgever', '')} {r.get('opmerking', '')}".lower()
            if q not in hay:
                continue
        out.append(r)
    return out


def _style_project_status_chips():
    for btn in _project_status_buttons:
        val = getattr(btn, "_status_val", None)
        if val is None:
            sel = not _selected_project_statuses
        else:
            sel = val in _selected_project_statuses
        if sel:
            btn.configure(
                fg_color=THEME_ACCENT_LIGHT,
                text_color=THEME_ACCENT,
                hover_color=THEME_ACCENT_LIGHT,
                border_color=THEME_ACCENT_LIGHT,
            )
        else:
            btn.configure(
                fg_color=THEME_WHITE,
                text_color=THEME_TEXT_PRIMARY,
                hover_color=THEME_BG_HOVER,
                border_color=THEME_BORDER,
            )


def _rebuild_project_status_chips():
    global _project_status_buttons
    if _frm_project_status_chips is None:
        return
    for b in _project_status_buttons:
        b.destroy()
    _project_status_buttons.clear()

    def toggle(val):
        if val is None:
            _selected_project_statuses.clear()
        elif val in _selected_project_statuses:
            _selected_project_statuses.discard(val)
        else:
            _selected_project_statuses.add(val)
        _style_project_status_chips()
        _apply_project_filters()

    def mk(text, val):
        btn = ctk.CTkButton(
            _frm_project_status_chips,
            text=text,
            height=28,
            font=desk.font_body(11),
            corner_radius=desk.RADIUS["md"],
            fg_color=THEME_WHITE,
            text_color=THEME_TEXT_PRIMARY,
            hover_color=THEME_BG_HOVER,
            border_width=1,
            border_color=THEME_BORDER,
        )
        btn._status_val = val
        btn.configure(command=lambda v=val: toggle(v))
        btn.pack(side=tk.LEFT, padx=2, pady=2)
        _project_status_buttons.append(btn)

    mk("Alles", None)
    for st in PROJECT_STATUSES:
        mk(st, st)
    _style_project_status_chips()


def _apply_project_filters():
    if _project_tree is None:
        return
    for iid in _project_tree.get_children():
        _project_tree.delete(iid)
    filtered = _filter_project_rows(_project_rows)
    for r in filtered:
        delta = display_delta(r)
        delta_txt = f"{delta:+.1f}" if delta is not None else ""
        _project_tree.insert(
            "",
            tk.END,
            iid=str(r.get("row_index")),
            values=(
                r.get("project", ""),
                r.get("opdrachtgever", ""),
                r.get("status", ""),
                f"{float(r.get('ureninschatting') or 0):.1f}",
                f"{float(r.get('gemaakte_uren') or 0):.1f}",
                delta_txt,
                (r.get("opmerking") or "")[:80],
            ),
        )
    if _project_summary_lbl is not None:
        summary = summarize_by_status(_project_rows)
        parts = [f"{len(filtered)} van {len(_project_rows)} projecten"]
        active = summary["active_planned"] or summary["active_actual"]
        if active:
            parts.append(
                f"actief {summary['active_actual']:.1f}/{summary['active_planned']:.1f} u"
            )
        if summary["over_budget"]:
            parts.append(f"{len(summary['over_budget'])} over budget")
        _project_summary_lbl.configure(text=" · ".join(parts))


def run_projecten():
    global _project_rows
    _project_rows = sort_estimates_by_recent_hours(load_estimate_rows(), load_hours_rows())
    _rebuild_project_status_chips()
    _apply_project_filters()


def _open_project_dialog(entry=None):
    dlg = ctk.CTkToplevel(root)
    dlg.title("Project bewerken" if entry else "Project toevoegen")
    dlg.transient(root)
    dlg.grab_set()
    dlg.geometry("420x480")
    form = ctk.CTkFrame(dlg, fg_color=THEME_BG)
    form.pack(fill=tk.BOTH, expand=True, padx=12, pady=12)

    datum_var = tk.StringVar(
        value=(
            entry["datum"].strftime("%Y-%m-%d")
            if entry and entry.get("datum")
            else datetime.today().strftime("%Y-%m-%d")
        )
    )
    og_var = tk.StringVar(value=entry.get("opdrachtgever", "") if entry else "")
    proj_var = tk.StringVar(value=entry.get("project", "") if entry else "")
    planned_var = tk.StringVar(value=str(entry.get("ureninschatting", 0)) if entry else "0")
    status_var = tk.StringVar(value=entry.get("status", DEFAULT_STATUS) if entry else DEFAULT_STATUS)
    opm_var = tk.StringVar(value=entry.get("opmerking", "") if entry else "")

    desk.muted_label(form, text="Datum").pack(anchor="w")
    desk.standard_entry(form, textvariable=datum_var).pack(fill=tk.X, pady=(0, 8))
    desk.muted_label(form, text="Opdrachtgever").pack(anchor="w")
    desk.standard_entry(form, textvariable=og_var).pack(fill=tk.X, pady=(0, 8))
    desk.muted_label(form, text="Project").pack(anchor="w")
    desk.standard_entry(form, textvariable=proj_var).pack(fill=tk.X, pady=(0, 8))
    desk.muted_label(form, text="Ureninschatting").pack(anchor="w")
    desk.standard_entry(form, textvariable=planned_var).pack(fill=tk.X, pady=(0, 8))
    desk.muted_label(form, text="Status").pack(anchor="w")
    ctk.CTkComboBox(
        form,
        values=PROJECT_STATUSES,
        variable=status_var,
        font=desk.font_body(12),
    ).pack(fill=tk.X, pady=(0, 8))
    desk.muted_label(form, text="Opmerking").pack(anchor="w")
    desk.standard_entry(form, textvariable=opm_var).pack(fill=tk.X, pady=(0, 8))

    if entry:
        actual = float(entry.get("gemaakte_uren") or 0)
        delta = display_delta(entry)
        info = f"Gemaakte uren: {actual:.1f} u"
        if delta is not None:
            info += f"  |  Delta: {delta:+.1f} u"
        desk.muted_label(form, text=info).pack(anchor="w", pady=(4, 8))

    def save():
        try:
            planned = float((planned_var.get() or "0").replace(",", "."))
        except ValueError:
            messagebox.showerror("Fout", "Ongeldige ureninschatting.", parent=dlg)
            return
        if not proj_var.get().strip():
            messagebox.showerror("Fout", "Project is verplicht.", parent=dlg)
            return
        if entry:
            ok = update_estimate_row(
                entry["row_index"],
                datum_var.get(),
                og_var.get(),
                proj_var.get(),
                planned,
                status_var.get(),
                opm_var.get(),
            )
        else:
            ok = add_estimate_row(
                datum_var.get(),
                og_var.get(),
                proj_var.get(),
                planned,
                status_var.get(),
                opm_var.get(),
            )
        if ok:
            dlg.destroy()
            run_projecten()

    def delete():
        if not entry:
            return
        if not messagebox.askyesno("Verwijderen", "Projectrij verwijderen uit Excel?", parent=dlg):
            return
        if delete_estimate_row(entry["row_index"]):
            dlg.destroy()
            run_projecten()

    btn_row = ctk.CTkFrame(form, fg_color="transparent")
    btn_row.pack(fill=tk.X, pady=(8, 0))
    desk.primary_button(btn_row, text="Opslaan", command=save).pack(side=tk.LEFT, padx=(0, 8))
    desk.secondary_button(btn_row, text="Annuleren", command=dlg.destroy).pack(side=tk.LEFT)
    if entry:
        desk.secondary_button(btn_row, text="Verwijderen", command=delete).pack(side=tk.RIGHT)


def _on_project_tree_double_click(_event=None):
    if _project_tree is None:
        return
    sel = _project_tree.selection()
    if not sel:
        return
    row_index = int(sel[0])
    entry = next((r for r in _project_rows if r.get("row_index") == row_index), None)
    if entry:
        _open_project_dialog(entry)


def _refresh_grafieken_chart():
    global _analyse_chart_cv, _analyse_chart_var, _analyse_chart_year, _analyse_chart_euro
    if _analyse_chart_cv is None or _analyse_chart_var is None:
        return
    mode = _analyse_chart_var.get()
    base = _filter_rows_for_charts(_analyse_rows)
    year = _analyse_chart_year.get() if _analyse_chart_year else chart_year_from_rows(base)
    year_rows = rows_for_chart_year(base, year)
    labels: list[str] = []
    values: list[float] = []
    values2: list[float] = []
    title = ""
    chart_type = "bar"
    month_labels = ["Jan", "Feb", "Mrt", "Apr", "Mei", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"]
    if mode == "week_year":
        data = aggregate_hours_per_iso_week(year_rows, year)
        labels = [f"W{w}" for w, _ in data]
        values = [v for _, v in data]
        title = f"Uren per ISO-week {year}"
    elif mode == "month_year":
        data = aggregate_hours_per_month(year_rows, year)
        labels = [month_labels[m - 1] for m, _ in data]
        values = [v for _, v in data]
        title = f"Uren per maand {year}"
    elif mode == "og_bar":
        data = aggregate_hours_per_opdrachtgever(year_rows, 10)
        labels = [k for k, _ in data]
        values = [v for _, v in data]
        title = f"Uren per opdrachtgever {year}"
    elif mode == "og_pie":
        data = aggregate_hours_per_opdrachtgever(year_rows, 10)
        labels = [k for k, _ in data]
        values = [v for _, v in data]
        title = f"Uren per opdrachtgever {year}"
        chart_type = "pie"
    elif mode == "revenue_month":
        data = aggregate_revenue_per_month(year_rows, year)
        labels = [month_labels[m - 1] for m, _ in data]
        values = [v for _, v in data]
        title = f"Omzet (\u20ac) per maand {year}"
    elif mode == "locatie":
        data = aggregate_hours_per_locatie(year_rows, 12)
        labels = [k for k, _ in data]
        values = [v for _, v in data]
        title = f"Uren per locatie {year}"
    elif mode == "cumulative":
        cu, ce = aggregate_cumulative_for_year(year_rows, year)
        labels = [d[5:] for d, _ in cu]
        values = [v for _, v in cu]
        if _analyse_chart_euro and _analyse_chart_euro.get():
            values2 = [v for _, v in ce]
        title = f"Cumulatief uren {year}" + (" + omzet" if values2 else "")
        chart_type = "line"
    _analyse_chart_cv.set_data(
        labels,
        values,
        title=title,
        chart_type=chart_type,
        values2=values2 or None,
        series2_label="omzet \u20ac" if values2 else "",
    )
    _analyse_chart_cv.redraw()


def _update_period_btn_style():
    active = period_mode.get()
    for key, btn in period_btns.items():
        sel = key == active
        if sel:
            btn.configure(
                fg_color=THEME_ACCENT_LIGHT,
                text_color=THEME_ACCENT,
                hover_color=THEME_ACCENT_LIGHT,
                border_color=THEME_ACCENT_LIGHT,
            )
        else:
            btn.configure(
                fg_color=THEME_WHITE,
                text_color=THEME_TEXT_PRIMARY,
                hover_color=THEME_BG_HOVER,
                border_color=THEME_BORDER,
            )


def set_period(m):
    period_mode.set(m)
    if frm_custom is not None:
        frm_custom.pack_forget()
    if frm_week_custom is not None:
        frm_week_custom.pack_forget()
    if m == "custom_month" and frm_custom is not None:
        frm_custom.pack(fill=tk.X, pady=4)
    elif m == "custom_week" and frm_week_custom is not None:
        frm_week_custom.pack(fill=tk.X, pady=4)
    _update_period_btn_style()
    _apply_analyse_filters()


# ====== GUI OPBOUW ======
style = ttk.Style(root)
style.theme_use("clam")
style.configure("TFrame", background=THEME_BG)
style.configure("TLabel", font=FONT_UI, background=THEME_BG, foreground=THEME_TEXT_PRIMARY)
style.configure(
    "TButton",
    font=FONT_UI_BOLD,
    padding=(SPACING_MD, SPACING_SM),
    background=THEME_WHITE,
    foreground=THEME_TEXT_PRIMARY,
    bordercolor=THEME_BORDER,
    darkcolor=THEME_BORDER,
    lightcolor=THEME_WHITE,
    borderwidth=1,
    focuscolor=THEME_ACCENT_LIGHT,
)
style.map(
    "TButton",
    background=[("active", THEME_BG_HOVER), ("pressed", THEME_BG_TERTIARY), ("disabled", THEME_BG)],
    foreground=[("disabled", THEME_TEXT_TERTIARY)],
)
style.configure("TEntry", font=FONT_UI, fieldbackground=THEME_FIELD_BG, foreground=THEME_TEXT_PRIMARY, bordercolor=THEME_BORDER)
style.map("TEntry", bordercolor=[("focus", THEME_ACCENT)])
style.configure("TCombobox", font=FONT_UI, fieldbackground=THEME_FIELD_BG, foreground=THEME_TEXT_PRIMARY, bordercolor=THEME_BORDER)
style.map("TCombobox", bordercolor=[("focus", THEME_ACCENT)])
style.configure("TLabelframe", background=THEME_BG, bordercolor=THEME_BORDER)
style.configure("TLabelframe.Label", font=FONT_UI_BOLD, background=THEME_BG, foreground=THEME_TEXT_PRIMARY)
style.configure("Treeview", background=THEME_WHITE, fieldbackground=THEME_WHITE, foreground=THEME_TEXT_PRIMARY, borderwidth=1, relief="solid")
style.configure("Treeview.Heading", font=FONT_UI_BOLD, background=THEME_FIELD_BG, foreground=THEME_TEXT_SECONDARY, borderwidth=1)
style.map(
    "Treeview",
    background=[("selected", THEME_ACCENT_LIGHT)],
    foreground=[("selected", THEME_ACCENT)],
)
style.configure(
    "TScrollbar",
    background=THEME_FIELD_BG,
    troughcolor=THEME_BG,
    bordercolor=THEME_BORDER,
    arrowcolor=THEME_TEXT_SECONDARY,
    darkcolor=THEME_BORDER_STRONG,
    lightcolor=THEME_WHITE,
)


def _accent_button(parent, text, command=None, small=False):
    if small:
        return desk.small_primary_button(parent, text=text, command=command)
    return desk.primary_button(parent, text=text, command=command)


(
    opdrachtgevers,
    projecten,
    locaties,
    tarieven_pair,
    last_by_project,
    last_by_opdrachtgever,
    last_opd,
    last_proj,
    last_loc,
) = load_existing_data()

datum_var = tk.StringVar(value=datetime.today().strftime("%Y-%m-%d"))
opdrachtgever_var = tk.StringVar(value=last_opd if last_opd else "")
project_var = tk.StringVar(value=last_proj if last_proj else "")
locatie_var = tk.StringVar(value=last_loc if last_loc else "")
uren_var = tk.StringVar(value="1.0")
tarief_var = tk.StringVar(value="0.0")
totaal_var = tk.StringVar(value="€ -")
werkzaamheden_var = tk.StringVar(value="")

sel_lbl = None
dd_opd = dd_proj = dd_loc = None


def _on_dropdown_selected():
    _cascade_invoer_fields()


def _on_invoer_field_changed(*_args):
    _cascade_invoer_fields()


werkzaamheden_entry = None
history_scroll_list = None
history_search_var = None
history_search_entry = None
datum_entry = None
uren_entry = None
tarief_entry = None
lbl_invoer_day_stats = None
lbl_invoer_week_stats = None

frm_main = ctk.CTkFrame(content, fg_color=THEME_BG, corner_radius=0)
frm_main.grid(row=0, column=0, sticky="nsew", padx=SPACING_MD, pady=SPACING_MD)
frm_main.rowconfigure(0, weight=1)
frm_main.columnconfigure(0, weight=1)

tab_host = tk.Frame(frm_main, bg=THEME_BG, highlightthickness=0)
tab_host.grid(row=0, column=0, sticky="nsew")
tab_host.rowconfigure(0, weight=1)
tab_host.columnconfigure(0, weight=1)

tab_invoer = ctk.CTkFrame(tab_host, fg_color=THEME_BG, corner_radius=0)
tab_projecten = ctk.CTkFrame(tab_host, fg_color=THEME_BG, corner_radius=0)
tab_analyse = ctk.CTkFrame(tab_host, fg_color=THEME_BG, corner_radius=0)
tab_grafieken = ctk.CTkFrame(tab_host, fg_color=THEME_BG, corner_radius=0)
tab_invoer.grid(row=0, column=0, sticky="nsew")
tab_projecten.grid(row=0, column=0, sticky="nsew")
tab_analyse.grid(row=0, column=0, sticky="nsew")
tab_grafieken.grid(row=0, column=0, sticky="nsew")
tab_projecten.grid_remove()
tab_analyse.grid_remove()
tab_grafieken.grid_remove()

uren_nav_btns = []
_uren_current_tab = [0]


def _uren_select_tab(idx: int) -> None:
    prev = _uren_current_tab[0]
    tab_invoer.grid_remove()
    tab_projecten.grid_remove()
    tab_analyse.grid_remove()
    tab_grafieken.grid_remove()
    if idx == 0:
        tab_invoer.grid(row=0, column=0, sticky="nsew")
        root.after(50, lambda: _invoer_focus_widget(werkzaamheden_entry or (dd_opd._entry if dd_opd else None)))
    elif idx == 1:
        tab_projecten.grid(row=0, column=0, sticky="nsew")
        if prev != 1:
            run_projecten()
    elif idx == 2:
        tab_analyse.grid(row=0, column=0, sticky="nsew")
        if prev != 2:
            run_analyse()
    else:
        tab_grafieken.grid(row=0, column=0, sticky="nsew")
        if prev != 3:
            run_analyse()
        _refresh_grafieken_chart()
    _uren_current_tab[0] = idx
    for i, b in enumerate(uren_nav_btns):
        if i == idx:
            b.configure(
                fg_color=THEME_ACCENT_LIGHT,
                text_color=THEME_ACCENT,
                hover_color=THEME_ACCENT_LIGHT,
            )
        else:
            b.configure(
                fg_color="transparent",
                text_color=THEME_TEXT_SECONDARY,
                hover_color=THEME_BG_HOVER,
            )


_ctk_uf = ctk.CTkFont(family="Segoe UI", size=13)
_ctk_uh = ctk.CTkFont(family="Segoe UI", size=12, weight="bold")

ctk.CTkLabel(
    sidebar,
    text="Uren",
    anchor="w",
    font=_ctk_uh,
    text_color=THEME_TEXT_TERTIARY,
).pack(anchor="w", padx=SPACING_MD, pady=(SPACING_LG, SPACING_XS))

btn_nav_invoer = ctk.CTkButton(
    sidebar,
    text="  Invoer",
    anchor="w",
    height=36,
    corner_radius=RADIUS_MD,
    border_width=0,
    font=_ctk_uf,
    fg_color="transparent",
    text_color=THEME_TEXT_SECONDARY,
    hover_color=THEME_BG_HOVER,
    command=lambda: _uren_select_tab(0),
)
btn_nav_invoer.pack(fill="x", padx=SPACING_SM, pady=SPACING_XS)
uren_nav_btns.append(btn_nav_invoer)

btn_nav_projecten = ctk.CTkButton(
    sidebar,
    text="  Projecten",
    anchor="w",
    height=36,
    corner_radius=RADIUS_MD,
    border_width=0,
    font=_ctk_uf,
    fg_color="transparent",
    text_color=THEME_TEXT_SECONDARY,
    hover_color=THEME_BG_HOVER,
    command=lambda: _uren_select_tab(1),
)
btn_nav_projecten.pack(fill="x", padx=SPACING_SM, pady=SPACING_XS)
uren_nav_btns.append(btn_nav_projecten)

btn_nav_analyse = ctk.CTkButton(
    sidebar,
    text="  Analyse",
    anchor="w",
    height=36,
    corner_radius=RADIUS_MD,
    border_width=0,
    font=_ctk_uf,
    fg_color="transparent",
    text_color=THEME_TEXT_SECONDARY,
    hover_color=THEME_BG_HOVER,
    command=lambda: _uren_select_tab(2),
)
btn_nav_analyse.pack(fill="x", padx=SPACING_SM, pady=SPACING_XS)
uren_nav_btns.append(btn_nav_analyse)

btn_nav_grafieken = ctk.CTkButton(
    sidebar,
    text="  Grafieken",
    anchor="w",
    height=36,
    corner_radius=RADIUS_MD,
    border_width=0,
    font=_ctk_uf,
    fg_color="transparent",
    text_color=THEME_TEXT_SECONDARY,
    hover_color=THEME_BG_HOVER,
    command=lambda: _uren_select_tab(3),
)
btn_nav_grafieken.pack(fill="x", padx=SPACING_SM, pady=SPACING_XS)
uren_nav_btns.append(btn_nav_grafieken)

ctk.CTkFrame(sidebar, fg_color="transparent", height=4).pack(fill="x")
ctk.CTkFrame(sidebar, fg_color="transparent").pack(fill="both", expand=True)

btn_sidebar_excel = ctk.CTkButton(
    sidebar,
    text="  Open Excel",
    anchor="w",
    height=36,
    corner_radius=RADIUS_MD,
    font=_ctk_uf,
    fg_color=THEME_ACCENT,
    hover_color=THEME_ACCENT_HOVER,
    text_color=THEME_WHITE,
    command=open_excel,
)
btn_sidebar_excel.pack(fill="x", padx=SPACING_SM, pady=SPACING_XS)

btn_sidebar_ververs = ctk.CTkButton(
    sidebar,
    text="  Ververs lijsten",
    anchor="w",
    height=36,
    corner_radius=RADIUS_MD,
    font=_ctk_uf,
    fg_color=THEME_ACCENT,
    hover_color=THEME_ACCENT_HOVER,
    text_color=THEME_WHITE,
    command=reload_lists_and_maps,
)
btn_sidebar_ververs.pack(fill="x", padx=SPACING_SM, pady=SPACING_LG)

# Standaard tab: Analyse (zie onderaan, na opbouwen van het Analyse-paneel)

# --- Tab Invoer ---
tab_invoer.columnconfigure(0, weight=1)
tab_invoer.columnconfigure(1, weight=1)

frm_top = desk.card_frame(tab_invoer)
frm_top.grid(row=0, column=0, columnspan=2, sticky="ew", pady=4)
desk.section_title(frm_top, "Datum").grid(row=0, column=0, columnspan=4, sticky="w", padx=SPACING_MD, pady=(SPACING_MD, SPACING_SM))

desk.muted_label(frm_top, text="Datum:").grid(row=1, column=0, padx=5, pady=2)
datum_entry = desk.standard_entry(frm_top, textvariable=datum_var, width=120)
datum_entry.grid(row=1, column=1, padx=5, pady=2)
desk.secondary_button(frm_top, text="◀ Vorige dag", command=lambda: adjust_date(-1), width=110).grid(row=1, column=2, padx=2)
desk.secondary_button(frm_top, text="Volgende dag ▶", command=lambda: adjust_date(1), width=120).grid(row=1, column=3, padx=2)

frm_top.grid_columnconfigure(1, weight=1)
desk.muted_label(frm_top, text="Uren op deze dag:").grid(row=2, column=0, sticky="w", padx=(SPACING_MD, 4), pady=(SPACING_SM, SPACING_MD))
lbl_invoer_day_stats = desk.label_bold(frm_top, text="—", size=12)
lbl_invoer_day_stats.grid(row=2, column=1, sticky="w", pady=(SPACING_SM, SPACING_MD))
desk.muted_label(frm_top, text="Uren deze week:").grid(row=2, column=2, sticky="e", padx=4, pady=(SPACING_SM, SPACING_MD))
lbl_invoer_week_stats = desk.label_bold(frm_top, text="—", size=12)
lbl_invoer_week_stats.grid(row=2, column=3, sticky="w", padx=(0, SPACING_MD), pady=(SPACING_SM, SPACING_MD))

frm_proj = desk.card_frame(tab_invoer)
frm_proj.grid(row=1, column=0, sticky="nsew", padx=4, pady=4)
desk.section_title(frm_proj, "Projectgegevens").grid(
    row=0, column=0, columnspan=3, sticky="w", padx=SPACING_MD, pady=(SPACING_MD, SPACING_SM)
)

frm_invoer = desk.card_frame(tab_invoer)
frm_invoer.grid(row=1, column=1, sticky="nsew", padx=4, pady=4)
desk.section_title(frm_invoer, "Invoer").grid(
    row=0, column=0, columnspan=4, sticky="w", padx=SPACING_MD, pady=(SPACING_MD, SPACING_SM)
)
frm_invoer.grid_columnconfigure(1, weight=1)

frm_bottom = desk.card_frame(tab_invoer)
frm_bottom.grid(row=2, column=0, columnspan=2, sticky="nsew", pady=4)
desk.section_title(frm_bottom, "Historie — zoeken, bewerken (✎), verwijderen (✕)").grid(
    row=0, column=0, columnspan=2, sticky="w", padx=SPACING_MD, pady=(SPACING_MD, SPACING_SM)
)
tab_invoer.rowconfigure(2, weight=1)

hist_toolbar = ctk.CTkFrame(frm_bottom, fg_color="transparent", corner_radius=0)
hist_toolbar.grid(row=1, column=0, columnspan=2, sticky="ew", padx=SPACING_MD, pady=(0, SPACING_SM))
hist_toolbar.grid_columnconfigure(0, weight=1)

history_search_var = tk.StringVar()
history_search_entry = desk.standard_entry(hist_toolbar, textvariable=history_search_var)
history_search_entry.grid(row=0, column=0, sticky="ew", padx=(0, SPACING_SM))
desk.secondary_button(hist_toolbar, text="↩ Overnemen naar vandaag", command=apply_selected_history, width=180).grid(
    row=0, column=1, sticky="e"
)
history_status_lbl = ctk.CTkLabel(
    hist_toolbar,
    text="",
    font=desk.font_body(10),
    text_color=THEME_TEXT_TERTIARY,
    anchor="w",
)
history_status_lbl.grid(row=1, column=0, columnspan=2, sticky="w", pady=(SPACING_XS, 0))

_list_host = tk.Frame(frm_bottom, bg=THEME_BG, highlightthickness=0)
_list_host.grid(row=2, column=0, columnspan=2, sticky="nsew", padx=SPACING_MD, pady=(0, SPACING_MD))
frm_bottom.rowconfigure(2, weight=1)
frm_bottom.columnconfigure(0, weight=1)

frm_proj.grid_columnconfigure(1, weight=1)
desk.muted_label(frm_proj, text="Opdrachtgever:").grid(row=1, column=0, sticky="w", pady=2, padx=SPACING_MD)
dd_opd = create_searchable_dropdown(
    frm_proj, opdrachtgever_var, smart_opdrachtgevers, command=_on_dropdown_selected, width=32
)
dd_opd.grid(row=1, column=1, sticky="ew", pady=2)
desk.icon_outline_button(
    frm_proj,
    text="＋ Nieuw",
    command=lambda: add_new_value(opdrachtgevers, opdrachtgever_var, "opdrachtgever", dd_opd),
    width=72,
).grid(row=1, column=2, padx=2)

desk.muted_label(frm_proj, text="Project:").grid(row=2, column=0, sticky="w", pady=2, padx=SPACING_MD)
dd_proj = create_searchable_dropdown(
    frm_proj, project_var, smart_projecten, command=_on_dropdown_selected, width=32
)
dd_proj.grid(row=2, column=1, sticky="ew", pady=2)
desk.icon_outline_button(
    frm_proj,
    text="＋ Nieuw",
    command=lambda: add_new_value(projecten, project_var, "project", dd_proj),
    width=72,
).grid(row=2, column=2, padx=2)

desk.muted_label(frm_proj, text="Locatie:").grid(row=3, column=0, sticky="w", pady=2, padx=SPACING_MD)
dd_loc = create_searchable_dropdown(
    frm_proj, locatie_var, smart_locaties, command=_on_dropdown_selected, width=32
)
dd_loc.grid(row=3, column=1, sticky="ew", pady=2)
desk.icon_outline_button(
    frm_proj,
    text="＋ Nieuw",
    command=lambda: add_new_value(locaties, locatie_var, "locatie", dd_loc),
    width=72,
).grid(row=3, column=2, padx=2)

sel_lbl = ctk.CTkLabel(
    frm_proj,
    text="",
    font=desk.font_body(10),
    text_color=THEME_TEXT_SECONDARY,
    anchor="w",
    justify="left",
    wraplength=420,
)
sel_lbl.grid(row=4, column=0, columnspan=3, sticky="w", pady=(8, 0), padx=SPACING_MD)

desk.muted_label(frm_invoer, text="Werkzaamheden:").grid(row=1, column=0, sticky="w", pady=2, padx=SPACING_MD)
werkzaamheden_entry = desk.standard_entry(frm_invoer, textvariable=werkzaamheden_var, width=320)
werkzaamheden_entry.grid(row=1, column=1, columnspan=3, pady=2, sticky="ew", padx=(0, SPACING_MD))

desk.muted_label(frm_invoer, text="Uren:").grid(row=2, column=0, sticky="w", pady=2, padx=SPACING_MD)
uren_entry = desk.standard_entry(frm_invoer, textvariable=uren_var, width=72)
uren_entry.grid(row=2, column=1, sticky="w")
desk.secondary_button(frm_invoer, text="− ½ uur", command=lambda: adjust_hours(-0.5), width=72).grid(row=2, column=2, padx=2)
desk.secondary_button(frm_invoer, text="＋ ½ uur", command=lambda: adjust_hours(0.5), width=72).grid(row=2, column=3, padx=2)

desk.muted_label(frm_invoer, text="Tarief (€):").grid(row=3, column=0, sticky="w", pady=2, padx=SPACING_MD)
tarief_entry = desk.standard_entry(frm_invoer, textvariable=tarief_var, width=100)
tarief_entry.grid(row=3, column=1, sticky="w")

desk.muted_label(frm_invoer, text="Totaal:").grid(row=3, column=2, sticky="e", pady=2)
desk.label_bold(frm_invoer, textvariable=totaal_var, size=11).grid(row=3, column=3, sticky="w")

desk.primary_button(frm_invoer, text="Opslaan in urenstaat", command=add_entry).grid(row=4, column=0, columnspan=4, pady=10)

history_scroll_list = HistoryScrollList(_list_host)

setup_invoer_keyboard_nav()
apply_tarief_to_field()
uren_var.trace_add("write", update_total_label)
tarief_var.trace_add("write", update_total_label)
opdrachtgever_var.trace_add("write", lambda *_: _on_invoer_field_changed())
project_var.trace_add("write", lambda *_: _on_invoer_field_changed())
locatie_var.trace_add("write", lambda *_: _on_invoer_field_changed())
datum_var.trace_add("write", lambda *_: update_invoer_stats())
history_search_var.trace_add("write", lambda *_: schedule_refresh_history_list())
update_selection_label()
update_invoer_stats()
refresh_history_list()

# --- Tab Projecten ---
tab_projecten.columnconfigure(0, weight=1)
tab_projecten.rowconfigure(2, weight=1)

frm_project_top = desk.card_frame(tab_projecten)
frm_project_top.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
desk.section_title(frm_project_top, "Projectoverzicht (Ureninschattingen)").pack(
    anchor="w", padx=SPACING_MD, pady=(SPACING_MD, SPACING_XS)
)
_project_summary_lbl = desk.muted_label(frm_project_top, text="—")
_project_summary_lbl.pack(anchor="w", padx=SPACING_MD, pady=(0, SPACING_SM))

frm_project_filters = desk.card_frame(tab_projecten)
frm_project_filters.grid(row=1, column=0, sticky="ew", padx=4, pady=(0, 4))
frm_project_filters_inner = ctk.CTkFrame(frm_project_filters, fg_color="transparent")
frm_project_filters_inner.pack(fill=tk.X, padx=SPACING_MD, pady=SPACING_MD)
frm_project_filters_inner.grid_columnconfigure(1, weight=1)

desk.label_bold(frm_project_filters_inner, text="Status", size=10).grid(row=0, column=0, sticky="nw", padx=(0, 6), pady=2)
wrap_pst, _, _frm_project_status_chips = _make_horizontal_chip_scroller(frm_project_filters_inner, height=40)
wrap_pst.grid(row=0, column=1, sticky="ew", pady=2)

_project_search_var = tk.StringVar()
search_row = ctk.CTkFrame(frm_project_filters_inner, fg_color="transparent")
search_row.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(6, 0))
search_row.grid_columnconfigure(1, weight=1)
desk.muted_label(search_row, text="Zoeken:").grid(row=0, column=0, sticky="w", padx=(0, 6))
desk.standard_entry(search_row, textvariable=_project_search_var).grid(row=0, column=1, sticky="ew")
desk.primary_button(search_row, text="Nieuw project", command=lambda: _open_project_dialog(None), width=120).grid(
    row=0, column=2, padx=(8, 0)
)
_accent_button(search_row, "Vernieuw", run_projecten, small=True).grid(row=0, column=3, padx=(8, 0))

frm_project_tree_card = desk.card_frame(tab_projecten)
frm_project_tree_card.grid(row=2, column=0, sticky="nsew", padx=4, pady=4)
frm_project_tree_card.rowconfigure(1, weight=1)
frm_project_tree_card.columnconfigure(0, weight=1)
desk.section_title(frm_project_tree_card, "Projecten").grid(row=0, column=0, sticky="w", padx=SPACING_SM, pady=(SPACING_SM, SPACING_XS))

_project_tree = ttk.Treeview(
    frm_project_tree_card,
    columns=("c0", "c1", "c2", "c3", "c4", "c5", "c6"),
    show="headings",
    height=14,
)
for hid, txt, w in [
    ("c0", "Project", 180),
    ("c1", "Opdrachtgever", 120),
    ("c2", "Status", 110),
    ("c3", "Gepland", 64),
    ("c4", "Gemaakt", 64),
    ("c5", "Delta", 56),
    ("c6", "Opmerking", 200),
]:
    _project_tree.heading(hid, text=txt)
    _project_tree.column(hid, width=w, stretch=hid in ("c0", "c6"), minwidth=40)
scroll_proj = ttk.Scrollbar(frm_project_tree_card, orient=tk.VERTICAL, command=_project_tree.yview)
_project_tree.configure(yscrollcommand=scroll_proj.set)
_project_tree.grid(row=1, column=0, sticky="nsew", padx=(SPACING_SM, 0), pady=(0, SPACING_SM))
scroll_proj.grid(row=1, column=1, sticky="ns", pady=(0, SPACING_SM))
_project_tree.bind("<Double-1>", _on_project_tree_double_click)
desk.secondary_button(
    frm_project_tree_card, text="Bewerken", command=_on_project_tree_double_click, width=100
).grid(row=2, column=0, sticky="w", padx=SPACING_SM, pady=(0, SPACING_SM))

_project_search_var.trace_add("write", lambda *_: _apply_project_filters())

# --- Tab Analyse ---
tab_analyse.columnconfigure(0, weight=1)
tab_analyse.rowconfigure(0, weight=1)

paned_analyse = ttk.Panedwindow(tab_analyse, orient=tk.VERTICAL)
paned_analyse.grid(row=0, column=0, sticky="nsew", padx=2, pady=2)

frm_filters = desk.card_frame(paned_analyse)
desk.section_title(frm_filters, "Filters").pack(anchor="w", padx=SPACING_MD, pady=(SPACING_MD, SPACING_SM))
filt = ctk.CTkFrame(frm_filters, fg_color="transparent", corner_radius=0)
filt.pack(fill=tk.BOTH, expand=True, padx=SPACING_MD, pady=(0, SPACING_MD))
filt.grid_columnconfigure(1, weight=1)

r_f = 0
desk.label_bold(filt, text="Opdrachtgever", size=10).grid(row=r_f, column=0, sticky="nw", padx=(0, 6), pady=2)
wrap_og, _, frm_og_chips = _make_horizontal_chip_scroller(filt, height=44)
wrap_og.grid(row=r_f, column=1, sticky="ew", pady=2)
r_f += 1

desk.label_bold(filt, text="Project", size=10).grid(row=r_f, column=0, sticky="nw", padx=(0, 6), pady=2)
wrap_pr, _, frm_proj_chips = _make_horizontal_chip_scroller(filt, height=44)
wrap_pr.grid(row=r_f, column=1, sticky="ew", pady=2)
r_f += 1

frm_period = desk.card_frame(filt)
frm_period.grid(row=r_f, column=0, columnspan=2, sticky="ew", pady=4)
desk.section_title(frm_period, "Periode").pack(anchor="w", padx=SPACING_SM, pady=(SPACING_SM, SPACING_XS))
frm_period.grid_columnconfigure(0, weight=1)
r_f += 1

wrap_period, _, pf = _make_horizontal_chip_scroller(frm_period, height=44)
wrap_period.pack(fill=tk.X, padx=SPACING_SM, pady=(0, SPACING_SM))

for label, key in [
    ("Alles", "alles"),
    ("Deze week", "week"),
    ("Deze maand", "month"),
    ("Dit jaar", "year"),
    ("Maand kiezen", "custom_month"),
    ("Week kiezen", "custom_week"),
]:
    b = ctk.CTkButton(
        pf,
        text=label,
        height=28,
        font=desk.font_body(11),
        corner_radius=desk.RADIUS["md"],
        fg_color=THEME_WHITE,
        text_color=THEME_TEXT_PRIMARY,
        hover_color=THEME_BG_HOVER,
        border_width=1,
        border_color=THEME_BORDER,
        command=lambda k=key: set_period(k),
    )
    b.pack(side=tk.LEFT, padx=2, pady=2)
    period_btns[key] = b

frm_custom = tk.Frame(frm_period, bg=THEME_BG)
ttk.Label(frm_custom, text="Jaar:").pack(side=tk.LEFT, padx=4)
ttk.Spinbox(
    frm_custom,
    from_=2020,
    to=2035,
    textvariable=custom_year,
    width=6,
    command=_apply_analyse_filters,
).pack(side=tk.LEFT)
ttk.Label(frm_custom, text="Maand:").pack(side=tk.LEFT, padx=4)
ttk.Spinbox(
    frm_custom,
    from_=1,
    to=12,
    textvariable=custom_month,
    width=4,
    command=_apply_analyse_filters,
).pack(side=tk.LEFT)

frm_week_custom = tk.Frame(frm_period, bg=THEME_BG)
ttk.Label(frm_week_custom, text="Jaar (ISO):").pack(side=tk.LEFT, padx=4)
ttk.Spinbox(
    frm_week_custom,
    from_=2020,
    to=2035,
    textvariable=custom_week_year,
    width=6,
    command=_apply_analyse_filters,
).pack(side=tk.LEFT)
ttk.Label(frm_week_custom, text="Week:").pack(side=tk.LEFT, padx=4)
ttk.Spinbox(frm_week_custom, from_=1, to=53, textvariable=custom_week, width=4, command=_apply_analyse_filters).pack(
    side=tk.LEFT
)

frm_group = ctk.CTkFrame(filt, fg_color="transparent", corner_radius=0)
frm_group.grid(row=r_f, column=0, columnspan=2, sticky="w", pady=4)
r_f += 1
desk.label_bold(frm_group, text="Groeperen:", size=10).pack(side=tk.LEFT, padx=(0, 8))
for text, val in [
    ("Geen", "none"),
    ("Per project", "project"),
    ("Per opdrachtgever", "opdrachtgever"),
    ("Per week", "week"),
    ("Per maand", "month"),
]:
    ctk.CTkRadioButton(
        frm_group,
        text=text,
        variable=group_mode,
        value=val,
        command=_apply_analyse_filters,
        font=desk.font_body(12),
        text_color=THEME_TEXT_PRIMARY,
        fg_color=THEME_ACCENT,
        hover_color=THEME_ACCENT_LIGHT,
    ).pack(side=tk.LEFT, padx=6)

kw_row = ctk.CTkFrame(filt, fg_color="transparent", corner_radius=0)
kw_row.grid(row=r_f, column=0, columnspan=2, sticky="ew", pady=2)
r_f += 1
desk.muted_label(kw_row, text="Zoeken omschrijving:").pack(side=tk.LEFT, padx=(0, 6))
kw_inner = ctk.CTkFrame(kw_row, fg_color="transparent", corner_radius=0)
kw_inner.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=4)
desk.standard_entry(kw_inner, textvariable=keyword_var, width=280).pack(side=tk.LEFT, fill=tk.X, expand=True)
desk.secondary_button(kw_row, text="⌫ Wis zoekveld", command=lambda: (keyword_var.set(""), _apply_analyse_filters()), width=112).pack(side=tk.LEFT, padx=4)

desk.label_bold(filt, text="Uurtarief", size=10).grid(row=r_f, column=0, sticky="nw", padx=(0, 6), pady=2)
wrap_tr, _, frm_tarief_chips = _make_horizontal_chip_scroller(filt, height=40)
wrap_tr.grid(row=r_f, column=1, sticky="ew", pady=2)
r_f += 1

_accent_button(filt, "Vernieuw analyse", run_analyse).grid(row=r_f, column=0, columnspan=2, sticky="w", pady=(6, 2))

paned_analyse.add(frm_filters, weight=0)

frm_result_pane = ctk.CTkFrame(paned_analyse, fg_color=THEME_BG, corner_radius=0)
frm_result_pane.rowconfigure(0, weight=3)
frm_result_pane.rowconfigure(2, weight=1)
frm_result_pane.columnconfigure(0, weight=1)

frm_tree = desk.card_frame(frm_result_pane)
frm_tree.grid(row=0, column=0, sticky="nsew", pady=(0, 4), padx=2)
desk.section_title(frm_tree, "Resultaat").grid(row=0, column=0, columnspan=2, sticky="w", padx=SPACING_SM, pady=(SPACING_SM, SPACING_XS))
frm_tree.rowconfigure(1, weight=1)
frm_tree.columnconfigure(0, weight=1)

tree = ttk.Treeview(
    frm_tree,
    columns=("c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"),
    show="headings",
    height=8,
)
for hid, txt, w, st in [
    ("c0", "Datum / groep", 96, True),
    ("c1", "Opdrachtgever", 100, True),
    ("c2", "Project", 120, True),
    ("c3", "Locatie", 80, True),
    ("c4", "Uren", 52, False),
    ("c5", "Tarief €/u", 72, False),
    ("c6", "Bedrag €", 78, False),
    ("c7", "Omschrijving", 220, True),
]:
    tree.heading(hid, text=txt)
    tree.column(hid, width=w, stretch=st, minwidth=40)
scroll_y = ttk.Scrollbar(frm_tree, orient=tk.VERTICAL, command=tree.yview)
tree.configure(yscrollcommand=scroll_y.set)
tree.grid(row=1, column=0, sticky="nsew", padx=(SPACING_SM, 0), pady=(0, SPACING_SM))
scroll_y.grid(row=1, column=1, sticky="ns", pady=(0, SPACING_SM))


def _on_result_frame_configure(event):
    if tree is None or frm_tree is None:
        return
    if event.widget is not frm_tree:
        return
    try:
        h = event.height
        if h < 50:
            return
        rh = 22
        nh = max(6, (h - 8) // rh)
        cur = getattr(tree, "_dyn_height", 0)
        if nh != cur:
            tree._dyn_height = nh
            tree.configure(height=int(nh))
    except tk.TclError:
        pass


frm_tree.bind("<Configure>", _on_result_frame_configure)

lbl_summary = ctk.CTkLabel(frm_result_pane, text="", font=desk.font_body_bold(11), text_color=THEME_TEXT_PRIMARY, anchor="w")
lbl_summary.grid(row=1, column=0, sticky="w", pady=(2, 0))

frm_locatie = desk.card_frame(frm_result_pane)
frm_locatie.grid(row=2, column=0, sticky="nsew", pady=(4, 0), padx=2)
desk.section_title(frm_locatie, "Locatie overzicht (unieke dagen)").grid(
    row=0, column=0, columnspan=2, sticky="w", padx=SPACING_SM, pady=(SPACING_SM, SPACING_XS)
)
frm_locatie.rowconfigure(1, weight=1)
frm_locatie.columnconfigure(0, weight=1)

tree_locatie = ttk.Treeview(
    frm_locatie,
    columns=("loc0", "loc1", "loc2", "loc3"),
    show="headings",
    height=4,
)
for hid, txt, w, st in [
    ("loc0", "Locatie", 160, True),
    ("loc1", "Dagen", 60, False),
    ("loc2", "Uren", 60, False),
    ("loc3", "Bedrag \u20ac", 80, False),
]:
    tree_locatie.heading(hid, text=txt)
    tree_locatie.column(hid, width=w, stretch=st, minwidth=40)
scroll_loc_y = ttk.Scrollbar(frm_locatie, orient=tk.VERTICAL, command=tree_locatie.yview)
tree_locatie.configure(yscrollcommand=scroll_loc_y.set)
tree_locatie.grid(row=1, column=0, sticky="nsew", padx=(SPACING_SM, 0), pady=(0, SPACING_SM))
scroll_loc_y.grid(row=1, column=1, sticky="ns", pady=(0, SPACING_SM))

paned_analyse.add(frm_result_pane, weight=1)


# --- Tab Grafieken ---
tab_grafieken.columnconfigure(0, weight=1)
tab_grafieken.rowconfigure(0, weight=1)

frm_grafieken = desk.card_frame(tab_grafieken)
frm_grafieken.grid(row=0, column=0, sticky="nsew", padx=SPACING_MD, pady=SPACING_MD)
frm_grafieken.rowconfigure(1, weight=1)
frm_grafieken.columnconfigure(0, weight=1)
desk.section_title(frm_grafieken, "Grafieken").grid(row=0, column=0, sticky="w", padx=SPACING_SM, pady=(SPACING_SM, SPACING_XS))

frm_chart, _analyse_chart_cv, _analyse_chart_var, _analyse_chart_year, _chart_combo, _analyse_chart_euro, _chart_euro_cb = build_chart_frame(
    frm_grafieken, THEME_CANVAS_BG, THEME_ACCENT
)
frm_chart.grid(row=1, column=0, sticky="nsew", padx=SPACING_SM, pady=(0, SPACING_SM))


def _on_chart_setting_change(*_a):
    _refresh_grafieken_chart()


_chart_combo.bind("<<ComboboxSelected>>", lambda e: _on_chart_setting_change())
_analyse_chart_year.trace_add("write", lambda *_: _on_chart_setting_change())
_analyse_chart_euro.trace_add("write", lambda *_: _on_chart_setting_change())


def _set_analyse_sash():
    try:
        h = paned_analyse.winfo_height()
        if h > 200:
            paned_analyse.sashpos(0, min(320, max(220, h // 3)))
    except tk.TclError:
        pass


root.after(250, _set_analyse_sash)

keyword_var.trace_add("write", lambda *_: _apply_analyse_filters())
custom_year.trace_add("write", lambda *_: _apply_analyse_filters())
custom_month.trace_add("write", lambda *_: _apply_analyse_filters())
custom_week_year.trace_add("write", lambda *_: _apply_analyse_filters())
custom_week.trace_add("write", lambda *_: _apply_analyse_filters())


_update_period_btn_style()


def _show_main_window():
    try:
        root.deiconify()
        root.lift()
        root.focus_force()
    except tk.TclError:
        pass


def _open_quick_invoer_fixed():
    """Mini popup met vooringevulde datum en velden."""
    pop_holder = []

    def save_mini(datum, og, proj, werk, loc, uren, tarief):
        if not datum:
            datum = datetime.today().strftime("%Y-%m-%d")
        if not og.strip() or not proj.strip() or not loc.strip() or not werk.strip():
            messagebox.showerror("Fout", "Vul alle velden in.", parent=root)
            return
        rows = load_hours_rows()
        similar = find_similar_entries(rows, datum, og, proj, uren)
        if similar:
            if not messagebox.askyesno(
                "Vergelijkbare regel",
                f"Er staat al {len(similar)} vergelijkbare regel(s) op deze dag. Toch opslaan?",
                parent=root,
            ):
                return
        if add_entry_to_excel(datum, og.strip(), proj.strip(), werk.strip(), loc.strip(), uren, tarief):
            reload_lists_and_maps()
            messagebox.showinfo("Opgeslagen", "Uren opgeslagen.", parent=root)

    create_mini_invoer_popup(root, {"bg_primary": THEME_WHITE}, desk, save_mini)


def _quit_app():
    try:
        if _tray_stop:
            _tray_stop()
    except Exception:
        pass
    root.destroy()


_tray_stop = start_system_tray(
    root,
    os.path.join(_APP_DIR, "uren_app.ico"),
    _show_main_window,
    _open_quick_invoer_fixed,
    _quit_app,
) or (lambda: None)
register_global_hotkey(root, _open_quick_invoer_fixed)
_analyse_chart_cv.bind("<Configure>", lambda e: _analyse_chart_cv.redraw())


def _notify_update(title, message, url):
    if url:
        if messagebox.askyesno(title, f"{message}\n\nDownloadpagina openen?", parent=root):
            import webbrowser

            webbrowser.open(url)
    else:
        messagebox.showinfo(title, message, parent=root)


check_for_updates_async(root, _notify_update)

root.title(f"IMeTech Urenadministratie v{APP_VERSION}")

# Start op Analyse (na volledige GUI: run_analyse() wordt hier getriggerd)
_uren_select_tab(2)

root.mainloop()
