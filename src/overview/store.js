import { createStore, applyMiddleware, compose, combineReducers } from 'redux'
import { createEpicMiddleware, combineEpics } from 'redux-observable'
import thunk from 'redux-thunk'

import * as overview from './overview-ui'

const rootReducer = combineReducers({
    overview: overview.reducer,
})

const rootEpic = combineEpics(
    ...Object.values(overview.epics),
)

export default function configureStore({ ReduxDevTools = undefined } = {}) {
    const epicMiddleware = createEpicMiddleware()

    const enhancers = [
        overview.enhancer,
        applyMiddleware(
            epicMiddleware,
            thunk,
        ),
    ]
    if (ReduxDevTools) {
        enhancers.push(ReduxDevTools.instrument())
    }
    const enhancer = compose(...enhancers)

    const store = createStore(
        rootReducer,
        undefined, // initial state
        enhancer,
    )

    epicMiddleware.run(rootEpic)

    return store
}
