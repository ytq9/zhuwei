/** Shared source identities and display names; mechanical quantities and
 * effects remain in the character and frozen Ability authority. */
export const CLASS_RESOURCE_CATALOG: Readonly<Record<string, Readonly<{ resourceId: string; label: string }>>> = Object.freeze({
  surge: Object.freeze({ resourceId: "resource:action-surge", label: "动作如潮" }),
  secondWind: Object.freeze({ resourceId: "resource:second-wind", label: "回气" }),
  rage: Object.freeze({ resourceId: "resource:rage", label: "狂暴" }),
  channel: Object.freeze({ resourceId: "resource:channel-divinity", label: "引导神力" }),
  superiority: Object.freeze({ resourceId: "resource:superiority-die", label: "战术骰" }),
  warPriest: Object.freeze({ resourceId: "resource:war-priest", label: "战争祭司" }),
  breath: Object.freeze({ resourceId: "resource:breath-weapon", label: "吐息" }),
  relentless: Object.freeze({ resourceId: "resource:relentless-endurance", label: "不屈不挠" }),
});
