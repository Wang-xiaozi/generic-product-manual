import { createApp, h } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import router from './router'
import { RouterView } from 'vue-router'

const app = createApp({ render: () => h(RouterView) })
app.use(ElementPlus)
app.use(router)
app.mount('#app')
