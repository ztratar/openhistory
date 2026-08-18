import assert from "node:assert/strict";
import test from "node:test";
import {
  anchoredMenuBarWindowPosition,
  DOCK_TO_MENU_BAR_SHOW_DELAY_MS,
  menuBarToggleAction,
  menuBarTransitionShowDelay,
  usableTrayBounds
} from "./menu-bar-position";

test("a second tray click cancels a show that is still pending", () => {
  assert.equal(menuBarToggleAction(false, false), "show");
  assert.equal(menuBarToggleAction(false, true), "hide");
  assert.equal(menuBarToggleAction(true, false), "hide");
});

test("delays only the first show when switching from Dock to the menu bar", () => {
  assert.equal(menuBarTransitionShowDelay("dock", "menuBar"), DOCK_TO_MENU_BAR_SHOW_DELAY_MS);
  assert.equal(menuBarTransitionShowDelay("menuBar", "dock"), 0);
  assert.equal(menuBarTransitionShowDelay("menuBar", "menuBar"), 0);
  assert.equal(menuBarTransitionShowDelay("dock", "dock"), 0);
});

test("rejects provisional tray bounds at the screen origin", () => {
  assert.equal(usableTrayBounds({ x: 0, y: 0, width: 20, height: 20 }), false);
  assert.equal(anchoredMenuBarWindowPosition(
    { x: 0, y: 0, width: 20, height: 20 },
    { width: 440, height: 660 },
    { x: 0, y: 25, width: 1512, height: 919 }
  ), undefined);
});

test("rejects empty and non-finite tray bounds", () => {
  assert.equal(usableTrayBounds({ x: 1400, y: 0, width: 0, height: 0 }), false);
  assert.equal(usableTrayBounds({ x: Number.NaN, y: 0, width: 20, height: 20 }), false);
});

test("clamps a right-edge tray window inside the display", () => {
  assert.deepEqual(anchoredMenuBarWindowPosition(
    { x: 1400, y: 2, width: 20, height: 20 },
    { width: 440, height: 660 },
    { x: 0, y: 25, width: 1512, height: 919 }
  ), { x: 1064, y: 33 });
});

test("centers the window beneath ready tray bounds away from an edge", () => {
  assert.deepEqual(anchoredMenuBarWindowPosition(
    { x: 800, y: 2, width: 20, height: 20 },
    { width: 440, height: 660 },
    { x: 0, y: 25, width: 1512, height: 919 }
  ), { x: 590, y: 33 });
});

test("clamps the window inside displays with negative coordinates", () => {
  assert.deepEqual(anchoredMenuBarWindowPosition(
    { x: -1430, y: -1078, width: 20, height: 20 },
    { width: 440, height: 660 },
    { x: -1440, y: -1055, width: 1440, height: 875 }
  ), { x: -1432, y: -1047 });
});
