# E: two selected development controls

Both requested cases completed with supported facts, sufficient citations and the correct authority decision. Six other DEV cases were deliberately unrequested. Independent assistant-agent review checked the actual supplied chunks, rather than only matching expected values in the output.

| Case                  | Result                                           | Finding                                                                                                     | First visible |     Total |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------: | --------: |
| 02 approved retention | Supported                                        | Current 21 days, historical 14 days and explicit replacement are attributed to the correct passages 3:3/4:4 |      47.173 s | 178.818 s |
| 07 competing code     | Safe, complete abstention from a deployed result | Correct A=7/B=3 calculation, exact 12:12/13:13 and explicit missing production approval                     |      39.262 s | 127.926 s |

DEV07 no longer opens with the contradictory claim that both branches return 7. This is one observed success, not a guarantee that code reasoning is fixed. DEV02's initial 21-day answer gets its supporting marker later in the explanation; more immediate placement would be clearer, but the passage is correct and the material authority explanation is supported.

Both snapshots record LITE, actual 8192-token context and 14 GPU layers. E also makes hardware-limited FULL at 8K use standard depth and synchronizes the worker prompt after loading/restoring; the current observations do not separately exercise a FULL-at 8K profile. KV precision changed during restores (02:q8_0 toq4_0; 07:q4_0 tof16), so comparisons with earlier totals are descriptive. Median total for two requests is 153.372 seconds; median first-visible latency is 43.2175 seconds. There were no errors, cancellations or timeouts.

The build-provenance manifest is E (`826073a904228b18730fe401c2734f3b0d6e35c6fee99ffcd186a9a0944c553b`). Original raw output is retained. This selected development check precedes the reused original-heldout regression and the separately sealed reserved test; it is not either of those tests.
