// Junkpile example 18 — OSC network control
(
~junkpile = NetAddr("127.0.0.1", 9000);
~junkpile.sendMsg("/hue", 0.25);
~junkpile.sendMsg("/zoom", 0.65);
~junkpile.sendMsg("/field", 0.8);
)

// Animated test
(
Routine({
    400.do({ |index|
        var phase = index / 399;
        ~junkpile.sendMsg("/hue", phase);
        ~junkpile.sendMsg("/rotation", (phase * 2pi).sin.linlin(-1, 1, 0, 1));
        ~junkpile.sendMsg("/turbulence", (phase * 7pi).sin.abs);
        0.02.wait;
    });
}).play(AppClock);
)
