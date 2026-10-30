import { Mark, mergeAttributes } from '@tiptap/core';
import { isFontFamilyId, type FontFamilyId } from '@wiki/shared';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    font: {
      setFont: (family: FontFamilyId) => ReturnType;
      unsetFont: () => ReturnType;
    };
  }
}

/**
 * Schriftart als Mark: gespeichert wird nur die Kennung aus FONT_FAMILIES (S6),
 * die Schriften selbst setzt das Stylesheet über data-font (fonts.css).
 */
export const Font = Mark.create({
  name: 'font',

  addAttributes() {
    return {
      family: {
        default: null,
        parseHTML: (el) => {
          const family = el.getAttribute('data-font');
          return isFontFamilyId(family) ? family : null;
        },
        renderHTML: (attrs) => (isFontFamilyId(attrs.family) ? { 'data-font': attrs.family } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-font]', getAttrs: (el) => (isFontFamilyId((el as HTMLElement).getAttribute('data-font')) ? null : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFont:
        (family) =>
        ({ commands }) =>
          commands.setMark(this.name, { family }),
      unsetFont:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
