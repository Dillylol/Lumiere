package com.pedropathing.revhub.drivetrains;

import com.pedropathing.revhub.FakeVar;

/** Test stand-in with the device settings of Pedro Pathing 3's {@code MecanumConfig}. */
public class MecanumConfig {
    public final FakeVar<String> frontLeftName = new FakeVar<>();
    public final FakeVar<String> backLeftName = new FakeVar<>();
    public final FakeVar<String> frontRightName = new FakeVar<>();
    public final FakeVar<String> backRightName = new FakeVar<>();
    public final FakeVar<Double> powerThreshold = new FakeVar<>();
}
