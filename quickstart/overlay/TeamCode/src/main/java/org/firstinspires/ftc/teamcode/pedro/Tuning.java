package org.firstinspires.ftc.teamcode.pedro;

import com.pedropathing.algorithm.Foresight;
import com.pedropathing.revhub.drivetrains.Mecanum;
import com.pedropathing.revhub.localizers.PinpointLocalizer;
import com.pedropathing.tuning.autotune.Procedure;
import com.pedropathing.tuning.autotune.Tuner;

import org.firstinspires.ftc.teamcode.pedro.procedures.ForesightTuner;
import org.firstinspires.ftc.teamcode.pedro.procedures.MecanumTuner;
import org.firstinspires.ftc.teamcode.pedro.procedures.PinpointTuner;
import org.firstinspires.ftc.teamcode.pedro.procedures.Tests;

/**
 * Registers the Pedro Pathing AutoTune procedures for this robot.
 *
 * <p>Connect to the Robot Controller Wi-Fi and open http://192.168.43.1:10158. Run the tuners in
 * this order: Mecanum, Pinpoint, Foresight, then Tests. The procedures package is downloaded from
 * the official Pedro Pathing Quickstart when this project is created.
 */
public final class Tuning {
    private Tuning() {
    }

    @Tuner
    public static Procedure mecanum() {
        return new MecanumTuner();
    }

    @Tuner
    public static Procedure pinpoint() {
        return new PinpointTuner();
    }

    @Tuner
    public static Procedure foresight() {
        return new ForesightTuner(
                hardwareMap -> new PinpointLocalizer(hardwareMap, Constants.localizerConfig),
                hardwareMap -> new Mecanum(hardwareMap, Constants.drivetrainConfig)
        );
    }

    @Tuner
    public static Procedure tests() {
        return new Tests(
                hardwareMap -> new Mecanum(hardwareMap, Constants.drivetrainConfig),
                hardwareMap -> new PinpointLocalizer(hardwareMap, Constants.localizerConfig),
                () -> new Foresight(Constants.foresightConfig)
        );
    }
}
