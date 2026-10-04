import * as v from 'valibot'
import { request } from './request'

// Whether the app can serve pages, which the maintenance page polls during an outage.
export function checkAvailability() {
  return request('GET', '/api/v1/availability', undefined, v.boolean())
}
