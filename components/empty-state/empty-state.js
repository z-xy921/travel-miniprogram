Component({
  properties: {
    emoji: { type: String, value: '' },
    title: { type: String, value: '还没有内容' },
    desc: { type: String, value: '' },
    action: { type: String, value: '' }
  },

  methods: {
    onAction() {
      this.triggerEvent('action')
    }
  }
})
