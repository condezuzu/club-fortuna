// Don Fortunato is the mascot of the whole app (public/js/mascot.js): one per tab,
// always on screen. Games talk to him through this small adapter.
export function createDealer(api) {
  return {
    say: (kind, text) => api.dealer.say(kind, text),
    play: (anim) => api.dealer.play(anim),
    destroy() {},
  };
}
