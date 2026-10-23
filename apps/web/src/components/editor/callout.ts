import { mergeAttributes, Node } from '@tiptap/core';
import { CALLOUT_VARIANTS } from '@wiki/shared';

/** Info-, Warn-, Erfolgs- und Notizboxen; enthalten beliebige Blöcke */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el) => {
          const v = el.getAttribute('data-variant');
          return CALLOUT_VARIANTS.includes(v as never) ? v : 'info';
        },
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant, class: `callout callout-${attrs.variant}` }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-callout': '' }, HTMLAttributes), 0];
  },
});
