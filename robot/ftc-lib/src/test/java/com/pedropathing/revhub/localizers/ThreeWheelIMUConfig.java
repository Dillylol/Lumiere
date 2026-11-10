package com.pedropathing.revhub.localizers;

import com.pedropathing.revhub.FakeVar;

/** Test stand-in with the settings of Pedro Pathing 3's {@code ThreeWheelIMUConfig} that matter here. */
public class ThreeWheelIMUConfig {
    public final FakeVar<String> leftEncoderName = new FakeVar<>();
    public final FakeVar<String> rightEncoderName = new FakeVar<>();
    public final FakeVar<String> strafeEncoderName = new FakeVar<>();
    public final FakeVar<String> imuName = new FakeVar<>();
    public final FakeVar<Double> leftPodY = new FakeVar<>();
    public final FakeVar<Double> leftEncoderDirection = new FakeVar<>();
}
