Component({
  properties: {
    tabs: { type: Array, value: [] },
    active: { type: Number, value: 0 }
  },

  data: {
    showLeft: false,
    showRight: false,
    scrollLeft: 0,
    scrollInto: ''
  },

  lifetimes: {
    ready() {
      // 滚动状态放实例上，bindscroll 高频触发，不能每帧 setData
      this._scrollLeft = 0
      this._max = 0
      this._width = 0
      this.measure()
    }
  },

  observers: {
    // tabs 数量或 active 变化后：重新测量总宽，并把当前天滚进视野
    'tabs, active': function () {
      this.setData({ scrollInto: 'tab-' + this.data.active })
      wx.nextTick(() => this.measure())
    }
  },

  methods: {
    // 只有跨越阈值才 setData，避免滚动过程疯狂重渲染
    syncArrows(scrollLeft, max) {
      const showLeft = scrollLeft > 4
      const showRight = max > 4 && scrollLeft < max - 4
      if (showLeft !== this.data.showLeft || showRight !== this.data.showRight) {
        this.setData({ showLeft: showLeft, showRight: showRight })
      }
    },

    measure() {
      const that = this
      const query = this.createSelectorQuery()
      query.select('.tabs').boundingClientRect()
      query.select('.track').boundingClientRect()
      query.exec(function (res) {
        if (!res || !res[0] || !res[1]) return
        that._width = res[0].width || 0
        that._max = Math.max((res[1].width || 0) - that._width, 0)
        that.syncArrows(that._scrollLeft, that._max)
      })
    },

    onScroll(e) {
      const detail = e.detail || {}
      this._scrollLeft = detail.scrollLeft || 0
      this._max = Math.max((detail.scrollWidth || 0) - this._width, 0)
      this.syncArrows(this._scrollLeft, this._max)
    },

    // 点箭头：往左/右挪容器宽的 2/3，clamp 在合法区间；scroll-left 自带动画
    onArrow(e) {
      const dir = e.currentTarget.dataset.dir === 'left' ? -1 : 1
      const step = Math.max(this._width * 2 / 3, 120)
      const target = Math.min(Math.max(this._scrollLeft + dir * step, 0), this._max)
      if (Math.abs(target - this._scrollLeft) < 1) return
      this._scrollLeft = target
      this.setData({ scrollLeft: target })
    },

    onTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      if (!isFinite(index) || index === this.data.active) return
      this.setData({ scrollInto: 'tab-' + index })
      this.triggerEvent('change', { index: index })
    }
  }
})
