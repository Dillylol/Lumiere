package com.pedropathing.revhub.localizers;

import com.pedropathing.revhub.FakeVar;

/** Test stand-in for Pedro Pathing 3's {@code PinpointConfig}: one device, set with {@code name}. */
public class PinpointConfig {
    public final FakeVar<String> name = new FakeVar<>();
    public final FakeVar<Double> xPodOffset = new FakeVar<>();
}
